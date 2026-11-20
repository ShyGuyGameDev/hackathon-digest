import { createHash } from "node:crypto";

export const USER_AGENT = `HackathonDigestBot/0.1 (+${process.env.PUBLIC_ORIGIN ?? "http://localhost:8787"}/about)`;
const TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;

export interface FetchedPage {
  url: string;
  finalUrl: string | null;
  ok: boolean;
  statusCode: number | null;
  robotsAllowed: boolean;
  text: string; // normalized visible text
  metaDescription: string | null;
  links: { href: string; text: string }[];
  contentHash: string | null;
  error: string | null;
}

const robotsCache = new Map<string, Promise<string[]>>();

/** Disallow rules that apply to us ("*" group or our bot name). Missing robots.txt = allowed. */
async function disallowRules(origin: string, fetchImpl: typeof fetch): Promise<string[]> {
  let p = robotsCache.get(origin);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetchImpl(`${origin}/robots.txt`, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return [];
        const body = await res.text();
        if (/<html/i.test(body.slice(0, 200))) return []; // SPA fallback page, not a robots file
        return parseRobots(body);
      } catch {
        return [];
      }
    })();
    robotsCache.set(origin, p);
  }
  return p;
}

export function parseRobots(body: string, agent = "hackathondigestbot"): string[] {
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*(?:#.*)?$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!;
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], disallow: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === "disallow" && current && value) current.disallow.push(value);
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.disallow);
}

export function robotsAllows(rules: string[], path: string): boolean {
  return !rules.some((rule) => {
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern.endsWith("\\$") ? pattern.slice(0, -2) + "$" : pattern}`).test(path);
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", hellip: "…" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function extractText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function metaContent(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
  return content ? decodeEntities(content).trim() || null : null;
}

function extractLinks(html: string, base: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      out.push({ href: new URL(m[1]!, base).toString(), text: extractText(m[2]!).slice(0, 80) });
    } catch {
      /* ignore malformed hrefs */
    }
  }
  return out;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text.replace(/\d+/g, "#")).digest("hex").slice(0, 32);
}

/** Polite fetch of an official page: honours robots.txt, identifies itself, times out, caps size. */
export async function fetchPage(url: string, fetchImpl: typeof fetch = fetch): Promise<FetchedPage> {
  const empty: FetchedPage = {
    url, finalUrl: null, ok: false, statusCode: null, robotsAllowed: true, text: "", metaDescription: null,
    links: [], contentHash: null, error: null,
  };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ...empty, error: "invalid URL" };
  }
  const rules = await disallowRules(parsed.origin, fetchImpl);
  if (!robotsAllows(rules, parsed.pathname || "/")) return { ...empty, robotsAllowed: false, error: "disallowed by robots.txt" };

  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ...empty, finalUrl: res.url || null, statusCode: res.status, error: `HTTP ${res.status}` };
    if (!/html|text/i.test(type)) return { ...empty, finalUrl: res.url || null, statusCode: res.status, ok: true, error: `non-HTML content (${type})` };
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
    const html = buf.toString("utf8");
    const text = extractText(html);
    return {
      url,
      finalUrl: res.url || url,
      ok: true,
      statusCode: res.status,
      robotsAllowed: true,
      text,
      metaDescription: metaContent(html, "description") ?? metaContent(html, "og:description"),
      links: extractLinks(html, res.url || url),
      contentHash: hashText(text),
      error: null,
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}
