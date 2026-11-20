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
      if (table === "submissions") rows = rows.filter((r) => r.status === "pending" && ["email-digest", "daily-research", "deadline-update"].includes(String((r.payload as { source?: string })?.source)));
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
    async remove(table, filter) {
      const ids = new Set((/id=in\.\(([^)]*)\)/.exec(filter)?.[1] ?? "").split(","));
      tables[table] = (tables[table] ?? []).filter((r) => !ids.has(String(r.id)));
      if (table === "events") for (const t of ["eligibility", "event_sources", "event_overrides"]) tables[t] = (tables[t] ?? []).filter((r) => !ids.has(String(r.event_id)));
    },
  };
}

const PAGES: Record<string, string> = {
  "https://alpha.example/": "<p>Alpha is a hackathon for high school students.</p>",
  "https://newhack.example/": "<p>NewHack is open to all high schoolers worldwide.</p>",
  "https://vague.example/": "<p>A weekend of building.</p>",
  "https://slow.example/": "<p>Slow Hacks is for high school students.</p><p>Submissions are due January 12, 2027 at 11:59 PM PT.</p>",
  "https://past.example/": "<p>Past Hacks welcomes high school students.</p>",
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
  assert.equal(result.queued.length, 2);
  assert.equal(sb.tables.ingestion_runs!.length, 1);

  // Running again is idempotent.
  await syncSupabase(sb, schemaSql, { now: NOW, fetchImpl: offlineFetch });
  assert.equal(sb.tables.events!.length, 3);
  assert.equal(sb.tables.event_sources!.length, 3);
});

test("sync applies verified deadline updates and removes events whose deadline has passed", async () => {
  const sb = fakeSupabase({ events: [], eligibility: [], event_sources: [], event_overrides: [], ingestion_runs: [], submissions: [
    { id: 10, status: "pending", payload: { source: "daily-research", name: "Slow Hacks", websiteUrl: "https://slow.example/", startAt: day(50), endAt: day(53), format: "online" } },
    { id: 11, status: "pending", payload: { source: "daily-research", name: "Past Hacks", websiteUrl: "https://past.example/", startAt: day(-5), endAt: day(-3), format: "online" } },
  ] });
  // Day 1: both queued events are processed; the one that already ended is never kept.
  const first = await syncSupabase(sb, schemaSql, { now: NOW, fetchImpl: offlineFetch });
  assert.deepEqual(sb.tables.events!.map((e) => e.name), ["Slow Hacks"]);
  assert.equal(first.removed.length, 1);
  assert.equal(sb.tables.submissions!.find((s) => s.id === 11)!.status, "rejected");
  const slow = sb.tables.events![0]!;
  assert.equal(slow.submission_deadline_status, "unverified");

  // Day 2: research reports deadlines. A quote that's on the page is applied; a made-up one isn't.
  sb.tables.submissions!.push(
    { id: 12, status: "pending", payload: { source: "deadline-update", slug: slow.slug, submissionDeadlineAt: "2027-01-13T07:59:00Z", sourceUrl: "https://slow.example/", quote: "Submissions are due January 12, 2027 at 11:59 PM PT." } },
    { id: 13, status: "pending", payload: { source: "deadline-update", slug: slow.slug, submissionDeadlineAt: "2027-01-01T00:00:00Z", sourceUrl: "https://slow.example/", quote: "Deadline: January 1, 2027" } },
  );
  const second = await syncSupabase(sb, schemaSql, { now: NOW, fetchImpl: offlineFetch });
  const applied = second.deadlines.filter((d) => d.applied);
  assert.equal(applied.length, 1);
  assert.match(second.deadlines.find((d) => !d.applied)!.reason, /doesn't appear/);
  const updated = sb.tables.events!.find((e) => e.name === "Slow Hacks")!;
  assert.equal(updated.submission_deadline_status, "verified");
  assert.equal(new Date(String(updated.submission_deadline_at)).toISOString(), "2027-01-13T07:59:00.000Z");
  assert.equal(sb.tables.event_overrides!.length, 3, "the deadline is stored as overrides so re-ingestion keeps it");

  // Later: once that deadline passes, the event is deleted from Supabase entirely.
  const after = new Date("2027-01-14T00:00:00Z");
  const third = await syncSupabase(sb, schemaSql, { now: after, fetchImpl: offlineFetch });
  assert.equal(third.removed.length, 1);
  assert.equal(sb.tables.events!.length, 0);
  assert.equal(sb.tables.event_overrides!.length, 0);
  assert.equal(sb.tables.eligibility!.length, 0);
});
