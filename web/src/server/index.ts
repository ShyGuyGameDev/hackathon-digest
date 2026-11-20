import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventsResponse } from "../shared/types.ts";
import { runIngestion } from "../ingest/pipeline.ts";
import { SOURCE_PRIORITIES, SOURCES } from "../ingest/sources/index.ts";
import {
  HttpError, approveSubmission, getAdminEvent, listAdminEvents, listRuns, listSubmissions, rejectSubmission,
  setManualEligibility, setOverrides,
} from "./admin.ts";
import { isMockDatabase, openDatabase } from "./db.ts";
import { getEventDetail, getPublicEvents, lastIngestAt } from "./repo.ts";
import { allowSubmission, parseSubmission, saveSubmission } from "./submissions.ts";

const PROD = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "";

const db = openDatabase();
if (PROD && isMockDatabase(db)) {
  console.error("Refusing to start in production with a mock database (DATABASE_PATH points at seeded mock data).");
  process.exit(1);
}

const MAX_BODY = 32 * 1024;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/application\/json/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Expected application/json");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function isAdmin(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!ADMIN_TOKEN || !token) return false;
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(ADMIN_TOKEN).digest();
  return timingSafeEqual(a, b);
}

let ingesting: Promise<unknown> | null = null;
function ingestNow(force: boolean) {
  if (isMockDatabase(db)) throw new HttpError(409, "This is a mock database; ingestion is disabled.");
  ingesting ??= runIngestion(db, SOURCES, { force, extraPriorities: SOURCE_PRIORITIES, log: (m) => console.log(m) })
    .finally(() => (ingesting = null));
  return ingesting;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const now = new Date();
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/api/events") {
    const body: EventsResponse = {
      generatedAt: now.toISOString(),
      mock: isMockDatabase(db),
      lastIngestAt: lastIngestAt(db),
      events: getPublicEvents(db, now),
    };
    const etag = `"${createHash("sha1").update(JSON.stringify(body.events)).digest("hex").slice(0, 20)}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { etag });
      return void res.end();
    }
    return send(res, 200, body, { etag, "cache-control": "public, max-age=60" });
  }

  if (method === "GET" && path === "/api/meta") {
    return send(res, 200, { mock: isMockDatabase(db), lastIngestAt: lastIngestAt(db) }, { "cache-control": "public, max-age=60" });
  }

  const detail = /^\/api\/events\/([a-z0-9-]+)$/.exec(path);
  if (method === "GET" && detail) {
    const event = getEventDetail(db, detail[1]!);
    if (!event) throw new HttpError(404, "No verified hackathon at this address.");
    return send(res, 200, { event, mock: isMockDatabase(db) }, { "cache-control": "public, max-age=60" });
  }

  if (method === "POST" && path === "/api/submissions") {
    const ip = req.socket.remoteAddress ?? "unknown";
    if (!allowSubmission(ip, now.getTime())) throw new HttpError(429, "Too many submissions. Try again later.");
    const body = await readJson(req);
    if (body.website_confirm) return send(res, 202, { ok: true }); // honeypot field filled by bots
    const id = saveSubmission(db, parseSubmission(body), now);
    return send(res, 201, { ok: true, id });
  }

  if (path.startsWith("/api/admin/")) {
    if (!ADMIN_TOKEN) throw new HttpError(503, "Admin is disabled: set ADMIN_TOKEN on the server.");
    if (!isAdmin(req)) throw new HttpError(401, "Invalid admin token");
    const sub = path.slice("/api/admin".length);
    let m: RegExpExecArray | null;
    if (method === "GET" && sub === "/events") return send(res, 200, { events: listAdminEvents(db, now) });
    if ((m = /^\/events\/([\w-]+)$/.exec(sub))) {
      if (method === "GET") return send(res, 200, getAdminEvent(db, m[1]!));
      if (method === "PATCH") {
        const body = await readJson(req);
        setOverrides(db, m[1]!, (body.overrides as Record<string, unknown>) ?? {}, typeof body.note === "string" ? body.note : null, now);
        return send(res, 200, getAdminEvent(db, m[1]!));
      }
    }
    if (method === "PUT" && (m = /^\/events\/([\w-]+)\/eligibility$/.exec(sub))) {
      setManualEligibility(db, m[1]!, await readJson(req), now);
      return send(res, 200, getAdminEvent(db, m[1]!));
    }
    if (method === "GET" && sub === "/submissions") return send(res, 200, { submissions: listSubmissions(db) });
    if (method === "POST" && (m = /^\/submissions\/(\d+)\/approve$/.exec(sub))) {
      const body = await readJson(req);
      const eventId = approveSubmission(db, Number(m[1]), (body.event as Record<string, unknown>) ?? {}, now);
      return send(res, 200, { ok: true, eventId });
    }
    if (method === "POST" && (m = /^\/submissions\/(\d+)\/reject$/.exec(sub))) {
      const body = await readJson(req);
      rejectSubmission(db, Number(m[1]), typeof body.note === "string" ? body.note : null, now);
      return send(res, 200, { ok: true });
    }
    if (method === "GET" && sub === "/runs") return send(res, 200, { runs: listRuns(db), running: Boolean(ingesting) });
    if (method === "POST" && sub === "/ingest") {
      void ingestNow(true).catch((err) => console.error("ingest failed", err));
      return send(res, 202, { ok: true });
    }
  }
  throw new HttpError(404, "Not found");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2", ".webmanifest": "application/manifest+json",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "content-security-policy":
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (!existsSync(DIST)) {
    res.writeHead(503, { "content-type": "text/plain" });
    return void res.end("Frontend not built. Run `npm run build`, or use `npm run dev` during development.");
  }
  const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, safe);
  const isAsset = file.startsWith(DIST) && existsSync(file) && statSync(file).isFile();
  if (!isAsset) file = join(DIST, "index.html"); // client-side routes
  const immutable = isAsset && safe.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    ...SECURITY_HEADERS,
  });
  if (req.method === "HEAD") return void res.end();
  res.end(readFileSync(file));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else if (req.method === "GET" || req.method === "HEAD") serveStatic(req, res, url);
    else throw new HttpError(405, "Method not allowed");
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Internal error" : (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`hackathon-digest web listening on http://localhost:${PORT}${isMockDatabase(db) ? " (MOCK DATA)" : ""}`);
});

if (process.env.INGEST_ON_SCHEDULE === "1" && !isMockDatabase(db)) {
  const hours = Math.max(1, Number(process.env.INGEST_INTERVAL_HOURS ?? 6));
  const tick = () => void ingestNow(false).catch((err) => console.error("scheduled ingest failed", err));
  setTimeout(tick, 5_000);
  setInterval(tick, hours * 3_600_000).unref();
  console.log(`Scheduled ingestion every ${hours}h (sources also enforce their own minimum intervals).`);
}
