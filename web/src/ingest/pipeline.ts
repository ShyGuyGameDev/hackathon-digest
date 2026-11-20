import { transaction, type DB } from "../server/db.ts";
import { listingState } from "../shared/dates.ts";
import { decideEligibility, type PageEvidence } from "./eligibility.ts";
import { fetchPage, hashText } from "./fetchPage.ts";
import { validateRecord } from "./normalize.ts";
import { loadEligibility, materializeEvent, saveEligibility, upsertSourceRecord } from "./store.ts";
import type { EligibilityClaim, SourceModule } from "./types.ts";

const PAGE_CACHE_HOURS = 20;
const MAX_LINKED_PAGES = 2;
const CONCURRENCY = 4;

export interface IngestOptions {
  now?: Date;
  fetchImpl?: typeof fetch;
  force?: boolean; // ignore per-source minimum intervals and the page cache
  log?: (msg: string) => void;
  /** Priorities for record origins outside `sources` (e.g. approved submissions). */
  extraPriorities?: Record<string, number>;
}

export interface SourceStats {
  source: string;
  skipped?: string;
  fetched: number;
  rejected: number;
  warnings: number;
  created: number;
  updated: number;
  mergedDuplicates: number;
  error?: string;
}

export interface IngestReport {
  sources: SourceStats[];
  eventsChecked: number;
  eligibility: Record<string, number>;
  listing: Record<string, number>;
}

export function sourcePriorities(sources: SourceModule[]): Record<string, number> {
  return Object.fromEntries(sources.map((s) => [s.id, s.priority]));
}

function lastSuccess(db: DB, source: string): string | null {
  const row = db
    .prepare("SELECT finished_at FROM ingestion_runs WHERE source = ? AND status = 'succeeded' ORDER BY id DESC LIMIT 1")
    .get(source) as { finished_at: string } | undefined;
  return row?.finished_at ?? null;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]!);
  }));
}

/** Fetches the official site plus up to two same-site rules/FAQ/eligibility pages, with caching. */
async function officialPages(
  db: DB,
  url: string,
  opts: Required<Pick<IngestOptions, "fetchImpl" | "force">> & { now: Date },
): Promise<{ evidence: PageEvidence; metaDescription: string | null }> {
  const cached = db.prepare("SELECT * FROM page_checks WHERE url = ?").get(url) as Record<string, unknown> | undefined;
  const fresh = cached && opts.now.getTime() - Date.parse(cached.checked_at as string) < PAGE_CACHE_HOURS * 3_600_000;
  if (fresh && !opts.force) {
    const stored = JSON.parse((cached.text_excerpt as string) || "{}") as { pages?: { url: string; text: string }[]; metaDescription?: string | null };
    return {
      evidence: { url, ok: cached.ok === 1, error: (cached.error as string) ?? null, contentHash: (cached.content_hash as string) ?? null, pages: stored.pages ?? [] },
      metaDescription: stored.metaDescription ?? null,
    };
  }

  const main = await fetchPage(url, opts.fetchImpl);
  // Many event sites render client-side, so the meta description is often the only readable text.
  const mainText = [main.metaDescription, main.text].filter(Boolean).join("\n");
  const pages: { url: string; text: string }[] = main.ok ? [{ url: main.finalUrl ?? url, text: mainText }] : [];
  if (main.ok) {
    const origin = new URL(main.finalUrl ?? url).origin;
    const linked = [...new Map(
      main.links
        .filter((l) => l.href.startsWith(origin) && /rules|faq|eligib|terms|about|participat/i.test(l.href + " " + l.text))
        .map((l) => [l.href.split("#")[0]!, l]),
    ).keys()].filter((href) => href !== (main.finalUrl ?? url)).slice(0, MAX_LINKED_PAGES);
    for (const href of linked) {
      const p = await fetchPage(href, opts.fetchImpl);
      if (p.ok && p.text) pages.push({ url: p.finalUrl ?? href, text: p.text });
    }
  }
  const combined = pages.map((p) => p.text).join("\n");
  const contentHash = main.ok ? hashText(combined) : null;
  db.prepare(
    `INSERT INTO page_checks (url, status_code, ok, final_url, content_hash, text_excerpt, robots_allowed, error, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET status_code = excluded.status_code, ok = excluded.ok, final_url = excluded.final_url,
       content_hash = excluded.content_hash, text_excerpt = excluded.text_excerpt, robots_allowed = excluded.robots_allowed,
       error = excluded.error, checked_at = excluded.checked_at`,
  ).run(
    url, main.statusCode, main.ok ? 1 : 0, main.finalUrl, contentHash,
    JSON.stringify({ pages: pages.map((p) => ({ url: p.url, text: p.text.slice(0, 60_000) })), metaDescription: main.metaDescription }),
    main.robotsAllowed ? 1 : 0, main.error, opts.now.toISOString(),
  );
  return { evidence: { url, ok: main.ok, error: main.error, contentHash, pages }, metaDescription: main.metaDescription };
}

/**
 * Discover → validate → dedupe/upsert → merge → verify eligibility (against the official site)
 * → record the run. Display logic never runs here; the site just reads the resulting tables.
 */
export async function runIngestion(db: DB, sources: SourceModule[], options: IngestOptions = {}): Promise<IngestReport> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {});
  const priorities = { ...options.extraPriorities, ...sourcePriorities(sources) };
  const touched = new Map<string, EligibilityClaim | undefined>();
  const report: IngestReport = { sources: [], eventsChecked: 0, eligibility: {}, listing: {} };

  for (const source of sources) {
    const stats: SourceStats = { source: source.id, fetched: 0, rejected: 0, warnings: 0, created: 0, updated: 0, mergedDuplicates: 0 };
    report.sources.push(stats);
    const last = lastSuccess(db, source.id);
    if (!options.force && last && now.getTime() - Date.parse(last) < source.minIntervalHours * 3_600_000) {
      stats.skipped = `ran ${Math.round((now.getTime() - Date.parse(last)) / 60_000)} min ago (minimum interval ${source.minIntervalHours}h)`;
      continue;
    }
    const run = db
      .prepare("INSERT INTO ingestion_runs (source, started_at, status) VALUES (?, ?, 'running')")
      .run(source.id, now.toISOString());
    try {
      const records = await source.fetchRecords({ fetch: fetchImpl, now, log });
      stats.fetched = records.length;
      transaction(db, () => {
        for (const { record, raw } of records) {
          const { record: valid, warnings } = validateRecord(record);
          stats.warnings += warnings.length;
          for (const w of warnings) log(`[${source.id}] ${record.name || record.externalId}: ${w}`);
          if (!valid) {
            stats.rejected++;
            continue;
          }
          const res = upsertSourceRecord(db, valid, raw, now);
          if (res.created) stats.created++;
          else stats.updated++;
          if (res.mergedIntoExisting) stats.mergedDuplicates++;
          // A reviewer's attestation outranks a directory listing, whichever source ran first.
          const prior = touched.get(res.eventId);
          touched.set(res.eventId, prior?.kind === "attested" ? prior : (valid.eligibilityClaim ?? prior));
        }
      });
      db.prepare("UPDATE ingestion_runs SET status = 'succeeded', finished_at = ?, stats = ? WHERE id = ?").run(
        new Date().toISOString(), JSON.stringify(stats), run.lastInsertRowid,
      );
    } catch (err) {
      stats.error = err instanceof Error ? err.message : String(err);
      log(`[${source.id}] failed: ${stats.error}`);
      db.prepare("UPDATE ingestion_runs SET status = 'failed', finished_at = ?, stats = ?, error = ? WHERE id = ?").run(
        new Date().toISOString(), JSON.stringify(stats), stats.error, run.lastInsertRowid,
      );
    }
  }

  // Merge every touched event, then (re)check eligibility against its official site.
  const ids = [...touched.keys()];
  for (const id of ids) materializeEvent(db, id, priorities, now);
  await mapLimit(ids, CONCURRENCY, async (id) => {
    const ev = db.prepare("SELECT website_url, registration_url, summary FROM events WHERE id = ?").get(id) as
      { website_url: string | null; registration_url: string | null; summary: string | null };
    const url = ev.website_url ?? ev.registration_url;
    const checked = url ? await officialPages(db, url, { fetchImpl, force: Boolean(options.force), now }) : null;
    const decision = decideEligibility(touched.get(id), checked?.evidence ?? null, loadEligibility(db, id), now);
    saveEligibility(db, id, decision.eligibility, decision.manual, decision.contentHash);
    if (!ev.summary && checked?.metaDescription) materializeEvent(db, id, priorities, now);
    db.prepare("UPDATE events SET last_verified_at = ? WHERE id = ?").run(now.toISOString(), id);
    report.eventsChecked++;
  });

  for (const row of db.prepare("SELECT status, COUNT(*) n FROM eligibility GROUP BY status").all() as { status: string; n: number }[]) {
    report.eligibility[row.status] = row.n;
  }
  const rows = db.prepare("SELECT submission_deadline_at, submission_deadline_status, start_at, end_at FROM events").all() as Record<string, string | null>[];
  for (const r of rows) {
    const state = listingState({
      submissionDeadlineAt: r.submission_deadline_at ?? null,
      submissionDeadlineStatus: (r.submission_deadline_status as "verified" | "unverified") ?? "unverified",
      startAt: r.start_at ?? null,
      endAt: r.end_at ?? null,
    }, now);
    report.listing[state] = (report.listing[state] ?? 0) + 1;
  }
  return report;
}

