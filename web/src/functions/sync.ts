// Supabase sync: the scheduled job behind /api/cron. It reuses the SQLite-based ingestion pipeline
// unchanged by loading Supabase's rows into an in-memory database, running ingestion there, and
// writing every row back. With a few hundred events this is far simpler than a second Postgres
// implementation of dedupe/merge/eligibility, and it keeps one source of truth for those rules.
import { DatabaseSync } from "node:sqlite";
import { runIngestion, type IngestReport } from "../ingest/pipeline.ts";
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

/** Hackathons the email routine recorded (pending submissions with payload.source = "email-digest"). */
export function digestSource(pending: Row[]): SourceModule {
  return {
    id: "digest",
    label: "Hackathon Digest email",
    priority: SOURCE_PRIORITIES.digest ?? 60,
    minIntervalHours: 0,
    async fetchRecords() {
      return pending.map((s) => {
        const p = (s.payload ?? {}) as Row;
        const format = (["online", "in_person", "hybrid"].includes(p.format as string) ? p.format : "online") as Format;
        const record: NormalizedEvent = {
          source: "digest",
          externalId: `digest-${s.id}`,
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
          // No eligibility claim and no verified deadline: the pipeline checks the official site,
          // and the event is published only if high school eligibility is confirmed there.
        };
        return { record, raw: p };
      });
    },
  };
}

export interface SyncResult {
  report: IngestReport;
  digestProcessed: { id: unknown; name: string; eventId: string | null; status: string | null }[];
  counts: Record<string, number>;
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
    sb.select("submissions", "select=id,payload&status=eq.pending&payload->>source=eq.email-digest&limit=500"),
  ]);
  insertRows(db, "events", events.map((r) => toSqlite(r)));
  insertRows(db, "eligibility", eligibility.map((r) => toSqlite(r)));
  insertRows(db, "event_sources", sources.map((r) => toSqlite(r, ["id"])));
  insertRows(db, "event_overrides", overrides.map((r) => toSqlite(r)));

  const report = await runIngestion(db, [hackClubSource, digestSource(pending)], {
    force: true,
    now,
    fetchImpl: options.fetchImpl,
    extraPriorities: SOURCE_PRIORITIES,
    log: options.log,
  });

  const all = (table: string) => db.prepare(`SELECT * FROM ${table}`).all() as Row[];
  await sb.upsert("events", all("events").map((r) => toPostgres(r)), "id");
  await sb.upsert("eligibility", all("eligibility").map((r) => toPostgres(r)), "event_id");
  await sb.upsert("event_sources", all("event_sources").map((r) => toPostgres(r, ["id"])), "source,external_id");

  // Close out the digest submissions that were turned into events.
  const digestProcessed: SyncResult["digestProcessed"] = [];
  for (const s of pending) {
    const link = db
      .prepare("SELECT s.event_id, el.status FROM event_sources s LEFT JOIN eligibility el ON el.event_id = s.event_id WHERE s.source = 'digest' AND s.external_id = ?")
      .get(`digest-${s.id}`) as { event_id: string; status: string | null } | undefined;
    const name = String(((s.payload ?? {}) as Row).name ?? "");
    digestProcessed.push({ id: s.id, name, eventId: link?.event_id ?? null, status: link?.status ?? null });
    if (!link) continue; // rejected by validation; stays pending so a reviewer can see it
    await sb.update("submissions", `id=eq.${s.id}`, {
      status: "approved",
      event_id: link.event_id,
      reviewed_at: now.toISOString(),
      review_note:
        link.status === "verified"
          ? "Imported automatically from the email digest; high school eligibility confirmed on the official site."
          : `Imported automatically from the email digest; eligibility is "${link.status ?? "unchecked"}", so it stays unpublished until reviewed.`,
    });
  }

  await sb.insert("ingestion_runs", [
    {
      source: "supabase-sync",
      started_at: now.toISOString(),
      finished_at: new Date().toISOString(),
      status: report.sources.some((s) => s.error) ? "failed" : "succeeded",
      stats: { report, digestProcessed },
      error: report.sources.map((s) => s.error).filter(Boolean).join("; ") || null,
    },
  ]);

  const counts = Object.fromEntries(
    ["events", "eligibility", "event_sources"].map((t) => [t, (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n]),
  );
  return { report, digestProcessed, counts };
}
