import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDatabase } from "../src/server/db.ts";
import { runIngestion } from "../src/ingest/pipeline.ts";
import type { NormalizedEvent, SourceModule } from "../src/ingest/types.ts";
import { syncSupabase, type SupabaseAdmin } from "../src/functions/sync.ts";

const NOW = new Date("2026-11-20T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const schemaSql = readFileSync(new URL("../migrations/001_init.sql", import.meta.url), "utf8");

const BOOL = ["solo_allowed", "hidden", "is_mock", "high_school_allowed", "international_allowed", "requires_college_enrollment", "manual", "needs_review"];
const JSON_COLS = ["categories", "technologies", "perks", "prizes", "schedule", "education_levels", "grades", "evidence", "normalized", "raw", "value"];

/** Converts SQLite rows to what PostgREST returns (booleans, parsed jsonb). */
function asPostgres(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const k of BOOL) if (k in out && out[k] !== null) out[k] = out[k] === 1;
  for (const k of JSON_COLS) if (typeof out[k] === "string") out[k] = JSON.parse(out[k] as string);
  return out;
}

/** In-memory stand-in for the PostgREST endpoints the sync uses. */
function fakeSupabase(tables: Record<string, Record<string, unknown>[]>): SupabaseAdmin & { tables: typeof tables } {
  const key = (table: string, conflict: string, r: Record<string, unknown>) => conflict.split(",").map((c) => String(r[c])).join("|");
  return {
    tables,
    async select(table, query) {
      let rows = tables[table] ?? [];
      if (table === "submissions") rows = rows.filter((r) => r.status === "pending" && (r.payload as { source?: string })?.source === "email-digest");
      if (query.includes("order=") && /limit=1$/.test(query)) rows = rows.slice(-1);
      return structuredClone(rows);
    },
    async upsert(table, rows, conflict) {
      const existing = (tables[table] ??= []);
      for (const r of rows) {
        const i = existing.findIndex((e) => key(table, conflict, e) === key(table, conflict, r));
        if (i === -1) existing.push(structuredClone(r));
        else existing[i] = { ...existing[i], ...structuredClone(r) };
      }
    },
    async insert(table, rows) {
      (tables[table] ??= []).push(...structuredClone(rows));
    },
    async update(table, filter, patch) {
      const id = Number(/id=eq\.(\d+)/.exec(filter)?.[1]);
      for (const r of tables[table] ?? []) if (r.id === id) Object.assign(r, patch);
    },
  };
}

const PAGES: Record<string, string> = {
  "https://alpha.example/": "<p>Alpha is a hackathon for high school students.</p>",
  "https://newhack.example/": "<p>NewHack is open to all high schoolers worldwide.</p>",
  "https://vague.example/": "<p>A weekend of building.</p>",
};
const offlineFetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
  if (url.includes("hackclub.com")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
  const body = PAGES[url];
  return body ? new Response(body, { status: 200, headers: { "content-type": "text/html" } }) : new Response("", { status: 404 });
}) as typeof fetch;

test("sync loads Supabase rows, ingests digest submissions, and writes everything back", async () => {
  // Seed: one reviewer-verified curated event, built with the real pipeline.
  const seed = openDatabase(":memory:");
  const curated: NormalizedEvent = {
    source: "curated", externalId: "alpha", sourceUrl: "https://alpha.example/", name: "Alpha Hacks", format: "online",
    websiteUrl: "https://alpha.example/", startAt: day(10), endAt: day(11),
    submissionDeadlineAt: day(11), submissionDeadlineVerified: true, submissionDeadlineSource: "https://alpha.example/",
    eligibilityClaim: { kind: "attested", eligibility: {
      status: "verified", highSchoolAllowed: true, educationLevels: ["high_school"], minAge: 13, maxAge: 18, grades: [],
      geographicRestrictions: null, internationalAllowed: null, requiresCollegeEnrollment: false, method: "manual",
      evidence: [{ url: "https://alpha.example/", quote: "for high school students" }], sourceUrl: "https://alpha.example/",
      checkedAt: NOW.toISOString(), notes: null } },
  };
  const curatedSource: SourceModule = { id: "curated", label: "c", priority: 100, minIntervalHours: 0, fetchRecords: async () => [{ record: curated, raw: {} }] };
  await runIngestion(seed, [curatedSource], { now: NOW, fetchImpl: offlineFetch });
  const dump = (t: string) => (seed.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]).map(asPostgres);

  const sb = fakeSupabase({
    events: dump("events"),
    eligibility: dump("eligibility"),
    event_sources: dump("event_sources"),
    event_overrides: [],
    ingestion_runs: [],
    submissions: [
      { id: 1, status: "pending", payload: { source: "email-digest", name: "NewHack 2027", websiteUrl: "https://newhack.example/", startAt: day(30), endAt: day(32), format: "online" } },
      { id: 2, status: "pending", payload: { source: "email-digest", name: "Vague Hack", websiteUrl: "https://vague.example/", startAt: day(40), format: "in_person", city: "San Jose", countryCode: "US" } },
      { id: 3, status: "pending", payload: { source: "organizer", name: "Not from the digest" } },
    ],
  });

  const result = await syncSupabase(sb, schemaSql, { now: NOW, fetchImpl: offlineFetch });

  assert.equal(sb.tables.events!.length, 3, "two digest events added, nothing duplicated");
  const byName = (n: string) => sb.tables.events!.find((e) => e.name === n)!;
  const elig = (id: unknown) => sb.tables.eligibility!.find((e) => e.event_id === id)!;

  // Verified on the official site → published; vague page → held back.
  assert.equal(elig(byName("NewHack 2027").id).status, "verified");
  assert.equal(elig(byName("Vague Hack").id).status, "unclear");
  // The reviewer's attestation on the curated event is untouched.
  assert.equal(elig(byName("Alpha Hacks").id).method, "manual");
  assert.equal(byName("Alpha Hacks").submission_deadline_status, "verified");

  // Postgres shapes are restored (booleans, jsonb), and digest submissions are closed out.
  assert.equal(typeof byName("NewHack 2027").hidden, "boolean");
  assert.ok(Array.isArray(byName("NewHack 2027").categories));
  const subs = sb.tables.submissions!;
  assert.equal(subs.find((s) => s.id === 1)!.status, "approved");
  assert.match(String(subs.find((s) => s.id === 2)!.review_note), /unpublished until reviewed/);
  assert.equal(subs.find((s) => s.id === 3)!.status, "pending", "organizer submissions are left for review");
  assert.equal(result.digestProcessed.length, 2);
  assert.equal(sb.tables.ingestion_runs!.length, 1);

  // Running again is idempotent.
  await syncSupabase(sb, schemaSql, { now: NOW, fetchImpl: offlineFetch });
  assert.equal(sb.tables.events!.length, 3);
  assert.equal(sb.tables.event_sources!.length, 3);
});
