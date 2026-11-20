// Supabase sync: the scheduled job behind /api/cron. It reuses the SQLite-based ingestion pipeline
// unchanged by loading Supabase's rows into an in-memory database, running ingestion there, and
// writing every row back. With a few hundred events this is far simpler than a second Postgres
// implementation of dedupe/merge/eligibility, and it keeps one source of truth for those rules.
import { DatabaseSync } from "node:sqlite";
import { listingState } from "../shared/dates.ts";
import { fetchPage } from "../ingest/fetchPage.ts";
import { runIngestion, type IngestReport } from "../ingest/pipeline.ts";
import { identifyingHost } from "../ingest/normalize.ts";
import { materializeEvent } from "../ingest/store.ts";
import { hackClubSource } from "../ingest/sources/hackclub.ts";
import { SOURCE_PRIORITIES } from "../ingest/sources/index.ts";
import type { Format } from "../shared/types.ts";
import type { NormalizedEvent, SourceModule } from "../ingest/types.ts";

type Row = Record<string, unknown>;

export interface SupabaseAdmin {
  select(table: string, query: string): Promise<Row[]>;
  upsert(table: string, rows: Row[], onConflict: string): Promise<void>;
  insert(table: string, rows: Row[]): Promise<void>;
  update(table: string, filter: string, patch: Row): Promise<void>;
  remove(table: string, filter: string): Promise<void>;
}

/** Minimal PostgREST client using the secret key (server-side only; bypasses RLS). */
export function supabaseAdmin(url: string, secretKey: string, fetchImpl: typeof fetch = fetch): SupabaseAdmin {
  const base = `${url.replace(/\/(rest\/v1\/?)?$/, "")}/rest/v1`;
  const headers = { apikey: secretKey, "content-type": "application/json" };
  const call = async (path: string, init: RequestInit) => {
    const res = await fetchImpl(`${base}/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
    return res;
  };
  return {
    async select(table, query) {
      return (await (await call(`${table}?${query}`, { method: "GET" })).json()) as Row[];
    },
    async upsert(table, rows, onConflict) {
      for (let i = 0; i < rows.length; i += 200) {
        await call(`${table}?on_conflict=${onConflict}`, {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows.slice(i, i + 200)),
        });
      }
    },
    async insert(table, rows) {
      await call(table, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    },
    async update(table, filter, patch) {
      await call(`${table}?${filter}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    },
    async remove(table, filter) {
      await call(`${table}?${filter}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
  };
}

// Column types that differ between Postgres (boolean/jsonb/timestamptz) and SQLite (int/text/text).
const BOOL = new Set(["solo_allowed", "hidden", "is_mock", "high_school_allowed", "international_allowed", "requires_college_enrollment", "manual", "needs_review"]);
const JSON_COLS = new Set(["categories", "technologies", "perks", "prizes", "schedule", "education_levels", "grades", "evidence", "normalized", "raw", "value"]);
const TS = new Set(["start_at", "end_at", "registration_deadline_at", "submission_deadline_at", "first_seen_at", "last_verified_at", "created_at", "updated_at", "checked_at", "last_seen_at"]);

function toSqlite(row: Row, skip: string[] = []): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.includes(k)) continue;
    if (v === null || v === undefined) out[k] = null;
    else if (BOOL.has(k)) out[k] = v ? 1 : 0;
    else if (JSON_COLS.has(k)) out[k] = JSON.stringify(v);
    else if (TS.has(k)) out[k] = new Date(String(v)).toISOString();
    else out[k] = v as never;
  }
  return out;
}

function toPostgres(row: Row, skip: string[] = []): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.includes(k)) continue;
    if (v === null || v === undefined) out[k] = null;
    else if (BOOL.has(k)) out[k] = v === 1 || v === true;
    else if (JSON_COLS.has(k)) out[k] = typeof v === "string" ? JSON.parse(v) : v;
    else out[k] = v;
  }
  return out;
}

function insertRows(db: DatabaseSync, table: string, rows: Row[]): void {
  for (const r of rows) {
    const cols = Object.keys(r);
    db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
      ...cols.map((c) => r[c] as never),
    );
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Queue kinds (submissions.payload.source) the sync processes automatically. */
const QUEUES = {
  "email-digest": { source: "digest", label: "the email digest" },
  "daily-research": { source: "research", label: "daily research" },
} as const;
type QueueKind = keyof typeof QUEUES;

/**
 * Hackathons queued by the routines (the weekly email and the daily research). They carry no
 * eligibility claim and no verified deadline: the pipeline checks each official site, and an
 * event is published only if high school eligibility is confirmed there.
 */
export function queueSource(kind: QueueKind, pending: Row[]): SourceModule {
  const { source } = QUEUES[kind];
  return {
    id: source,
    label: QUEUES[kind].label,
    priority: SOURCE_PRIORITIES[source] ?? 55,
    minIntervalHours: 0,
    async fetchRecords() {
      return pending.map((s) => {
        const p = (s.payload ?? {}) as Row;
        const format = (["online", "in_person", "hybrid"].includes(p.format as string) ? p.format : "online") as Format;
        const record: NormalizedEvent = {
          source,
          externalId: `${source}-${s.id}`,
          sourceUrl: str(p.websiteUrl),
          name: String(p.name ?? ""),
          organizer: str(p.organizer),
          summary: str(p.summary),
          websiteUrl: str(p.websiteUrl),
          registrationUrl: str(p.registrationUrl),
          rulesUrl: str(p.rulesUrl),
          startAt: str(p.startAt),
          endAt: str(p.endAt),
          format,
          city: str(p.city),
          state: str(p.state),
          country: str(p.country),
          countryCode: str(p.countryCode),
        };
        return { record, raw: p };
      });
    },
  };
}

/** Kept for callers/tests written against the email-only version. */
export const digestSource = (pending: Row[]) => queueSource("email-digest", pending);

const normalizeText = (t: string) =>
  t.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

export interface DeadlineResult {
  id: unknown;
  event: string | null;
  applied: boolean;
  reason: string;
}

/**
 * Applies deadlines found by the daily research routine. A deadline is accepted only if its
 * quote actually appears on the cited page when we fetch it now, so a misread search snippet
 * can't publish a date. Accepted deadlines become reviewer-style overrides (they survive
 * re-ingestion) and the event is re-merged.
 */
async function applyDeadlineUpdates(db: DatabaseSync, pending: Row[], now: Date, fetchImpl: typeof fetch | undefined): Promise<DeadlineResult[]> {
  const results: DeadlineResult[] = [];
  for (const s of pending) {
    const p = (s.payload ?? {}) as Row;
    const at = str(p.submissionDeadlineAt);
    const sourceUrl = str(p.sourceUrl);
    const quote = str(p.quote);
    const ev = (str(p.slug) && (db.prepare("SELECT id, name FROM events WHERE slug = ?").get(str(p.slug)) as Row | undefined)) ||
      (identifyingHost(str(p.websiteUrl)) &&
        (db.prepare("SELECT id, name FROM events WHERE website_host = ?").get(identifyingHost(str(p.websiteUrl))) as Row | undefined)) ||
      undefined;
    const fail = (reason: string) => results.push({ id: s.id, event: ev ? String(ev.name) : null, applied: false, reason });
    if (!ev) { fail("No matching event (by slug or website)."); continue; }
    if (!at || Number.isNaN(Date.parse(at))) { fail("Missing or invalid submissionDeadlineAt."); continue; }
    if (!sourceUrl || !/^https?:\/\//.test(sourceUrl)) { fail("Missing sourceUrl."); continue; }
    if (!quote || quote.length < 12) { fail("Missing quote (needs the exact wording from the page)."); continue; }
    const page = await fetchPage(sourceUrl, fetchImpl);
    const pageText = normalizeText([page.metaDescription ?? "", page.text].join(" "));
    if (!page.ok) { fail(`Couldn't load the source page (${page.error ?? "unknown error"}).`); continue; }
    if (!pageText.includes(normalizeText(quote))) { fail("The quote doesn't appear on the source page."); continue; }
    const id = String(ev.id);
    const upsert = db.prepare(
      `INSERT INTO event_overrides (event_id, field, value, note, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (event_id, field) DO UPDATE SET value = excluded.value, note = excluded.note, updated_at = excluded.updated_at`,
    );
    const note = `Daily research; quote verified on ${sourceUrl}: "${quote.slice(0, 300)}"`;
    upsert.run(id, "submissionDeadlineAt", JSON.stringify(new Date(at).toISOString()), note, now.toISOString());
    upsert.run(id, "submissionDeadlineVerified", "true", note, now.toISOString());
    upsert.run(id, "submissionDeadlineSource", JSON.stringify(sourceUrl), note, now.toISOString());
    materializeEvent(db, id, SOURCE_PRIORITIES, now);
    results.push({ id: s.id, event: String(ev.name), applied: true, reason: "Quote found on the source page." });
  }
  return results;
}

/** Events whose deadline has passed (or, with no verified deadline, that have ended). */
function closedEventIds(db: DatabaseSync, now: Date): string[] {
  const rows = db.prepare("SELECT id, submission_deadline_at, submission_deadline_status, start_at, end_at FROM events").all() as Row[];
  return rows
    .filter((r) =>
      listingState({
        submissionDeadlineAt: (r.submission_deadline_at as string) ?? null,
        submissionDeadlineStatus: r.submission_deadline_status === "verified" ? "verified" : "unverified",
        startAt: (r.start_at as string) ?? null,
        endAt: (r.end_at as string) ?? null,
      }, now) === "closed")
    .map((r) => String(r.id));
}

export interface SyncResult {
  report: IngestReport;
  queued: { id: unknown; kind: string; name: string; eventId: string | null; status: string | null }[];
  deadlines: DeadlineResult[];
  removed: string[];
  counts: Record<string, number>;
  /** @deprecated use `queued` */
  digestProcessed: { id: unknown; name: string; eventId: string | null; status: string | null }[];
}

export async function syncSupabase(
  sb: SupabaseAdmin,
  schemaSql: string, // migrations/001_init.sql, inlined by the bundler for the serverless function
  options: { fetchImpl?: typeof fetch; now?: Date; log?: (m: string) => void } = {},
): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);

  const [events, eligibility, sources, overrides, pending] = await Promise.all([
    sb.select("events", "select=*&limit=10000"),
    sb.select("eligibility", "select=*&limit=10000"),
    sb.select("event_sources", "select=*&limit=20000"),
    sb.select("event_overrides", "select=*&limit=20000"),
    sb.select("submissions", "select=id,payload&status=eq.pending&payload->>source=in.(email-digest,daily-research,deadline-update)&limit=1000"),
  ]);
  insertRows(db, "events", events.map((r) => toSqlite(r)));
  insertRows(db, "eligibility", eligibility.map((r) => toSqlite(r)));
  insertRows(db, "event_sources", sources.map((r) => toSqlite(r, ["id"])));
  insertRows(db, "event_overrides", overrides.map((r) => toSqlite(r)));

  const kindOf = (s: Row) => String(((s.payload ?? {}) as Row).source ?? "");
  const byKind = (k: string) => pending.filter((s) => kindOf(s) === k);

  // 1. New hackathons from the routines, plus the Hack Club directory.
  const report = await runIngestion(
    db,
    [hackClubSource, queueSource("email-digest", byKind("email-digest")), queueSource("daily-research", byKind("daily-research"))],
    { force: true, now, fetchImpl: options.fetchImpl, extraPriorities: SOURCE_PRIORITIES, log: options.log },
  );

  // 2. Deadlines the research routine found for events whose deadline was unconfirmed.
  const deadlines = await applyDeadlineUpdates(db, byKind("deadline-update"), now, options.fetchImpl);

  // 3. Remove everything whose deadline has passed. Done after ingestion so an event a source
  //    still lists is created and dropped in the same run, never left behind.
  const removed = closedEventIds(db, now);
  for (const id of removed) {
    for (const t of ["eligibility", "event_overrides"]) db.prepare(`DELETE FROM ${t} WHERE event_id = ?`).run(id);
    db.prepare("DELETE FROM event_sources WHERE event_id = ?").run(id);
    db.prepare("DELETE FROM events WHERE id = ?").run(id);
  }

  const all = (table: string) => db.prepare(`SELECT * FROM ${table}`).all() as Row[];
  await sb.upsert("events", all("events").map((r) => toPostgres(r)), "id");
  await sb.upsert("eligibility", all("eligibility").map((r) => toPostgres(r)), "event_id");
  await sb.upsert("event_sources", all("event_sources").map((r) => toPostgres(r, ["id"])), "source,external_id");
  await sb.upsert("event_overrides", all("event_overrides").map((r) => toPostgres(r)), "event_id,field");
  // Cascades to eligibility, event_sources and event_overrides; submissions keep a null event_id.
  const existing = new Set(events.map((e) => String(e.id)));
  const removeRemote = removed.filter((id) => existing.has(id));
  for (let i = 0; i < removeRemote.length; i += 100) await sb.remove("events", `id=in.(${removeRemote.slice(i, i + 100).join(",")})`);

  // 4. Close out every processed submission with a note explaining the outcome.
  const queued: SyncResult["queued"] = [];
  for (const [kind, { source, label }] of Object.entries(QUEUES)) {
    for (const s of byKind(kind)) {
      const link = db
        .prepare("SELECT s.event_id, el.status FROM event_sources s LEFT JOIN eligibility el ON el.event_id = s.event_id WHERE s.source = ? AND s.external_id = ?")
        .get(source, `${source}-${s.id}`) as { event_id: string; status: string | null } | undefined;
      const name = String(((s.payload ?? {}) as Row).name ?? "");
      queued.push({ id: s.id, kind, name, eventId: link?.event_id ?? null, status: link?.status ?? null });
      const wasRemoved = !link && report.sources.some((r) => r.source === source && r.fetched > 0);
      await sb.update("submissions", `id=eq.${s.id}`, link
        ? {
            status: "approved",
            event_id: link.event_id,
            reviewed_at: now.toISOString(),
            review_note: link.status === "verified"
              ? `Imported automatically from ${label}; high school eligibility confirmed on the official site.`
              : `Imported automatically from ${label}; eligibility is "${link.status ?? "unchecked"}", so it stays unpublished until reviewed.`,
          }
        : {
            status: "rejected",
            reviewed_at: now.toISOString(),
            review_note: wasRemoved
              ? `From ${label}: not added (invalid data, or its deadline has already passed).`
              : `From ${label}: not added.`,
          });
    }
  }
  for (const d of deadlines) {
    await sb.update("submissions", `id=eq.${d.id}`, {
      status: d.applied ? "approved" : "rejected",
      reviewed_at: now.toISOString(),
      review_note: `Deadline update${d.event ? ` for ${d.event}` : ""}: ${d.applied ? "applied" : "not applied"}. ${d.reason}`,
    });
  }

  await sb.insert("ingestion_runs", [
    {
      source: "supabase-sync",
      started_at: now.toISOString(),
      finished_at: new Date().toISOString(),
      status: report.sources.some((s) => s.error) ? "failed" : "succeeded",
      stats: { report, queued, deadlines, removed: removed.length },
      error: report.sources.map((s) => s.error).filter(Boolean).join("; ") || null,
    },
  ]);

  const counts = Object.fromEntries(
    ["events", "eligibility", "event_sources"].map((t) => [t, (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n]),
  );
  const digestProcessed = queued.filter((q) => q.kind === "email-digest").map(({ kind: _k, ...rest }) => rest);
  return { report, queued, deadlines, removed, counts, digestProcessed };
}
