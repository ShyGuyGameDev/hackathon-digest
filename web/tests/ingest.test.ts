import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, setMeta } from "../src/server/db.ts";
import { runIngestion } from "../src/ingest/pipeline.ts";
import type { NormalizedEvent, SourceModule } from "../src/ingest/types.ts";
import { getEventDetail, getPublicEvents } from "../src/server/repo.ts";
import { approveSubmission, setManualEligibility, setOverrides } from "../src/server/admin.ts";
import { parseSubmission, saveSubmission } from "../src/server/submissions.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const PAGES: Record<string, string> = {
  "https://alpha.example/": `<html><head><meta name="description" content="Alpha Hacks is a 24-hour hackathon for high school students in Ohio."></head><body><a href="/rules">Rules</a></body></html>`,
  "https://alpha.example/rules": "<p>Open to students in grades 9-12.</p>",
  "https://beta.example/": "<p>Beta is open only to university students.</p>",
  "https://gamma.example/": "<p>Gamma weekend.</p>",
};
const fakeFetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
  const body = PAGES[url];
  return body
    ? new Response(body, { status: 200, headers: { "content-type": "text/html" } })
    : new Response("down", { status: 503, headers: { "content-type": "text/html" } });
}) as typeof fetch;

function directoryRecord(id: string, o: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    source: "dir", externalId: id, sourceUrl: "https://dir.example/", name: id, format: "in_person", startAt: day(10), endAt: day(11),
    eligibilityClaim: { kind: "curated_directory", directory: "Dir", url: "https://dir.example/", statement: "High school directory." },
    ...o,
  };
}

let directoryRecords: NormalizedEvent[] = [];
const dirSource: SourceModule = { id: "dir", label: "Directory", priority: 50, minIntervalHours: 6, fetchRecords: async () => directoryRecords.map((record) => ({ record, raw: record })) };
let curatedRecords: NormalizedEvent[] = [];
const curatedSource: SourceModule = { id: "curated", label: "Curated", priority: 100, minIntervalHours: 0, fetchRecords: async () => curatedRecords.map((record) => ({ record, raw: record })) };

test("full pipeline: dedupe, merge priority, verification, publication rules, overrides", async () => {
  const db = openDatabase(":memory:");
  directoryRecords = [
    directoryRecord("alpha-1", { name: "Alpha Hacks 2026", websiteUrl: "https://alpha.example/", countryCode: "US", city: "Columbus", state: "Ohio" }),
    directoryRecord("beta-1", { name: "Beta Hack", websiteUrl: "https://beta.example/" }),
    directoryRecord("gamma-1", { name: "Gamma", websiteUrl: "https://gamma-down.example/" }),
    directoryRecord("bad-1", { name: "No Dates", startAt: "not a date", endAt: null }),
  ];
  curatedRecords = [
    {
      // Same event as alpha-1 (same site, start within 3 days) with an official, verified deadline.
      source: "curated", externalId: "alpha-official", sourceUrl: "https://alpha.example/", name: "Alpha Hacks", format: "in_person",
      websiteUrl: "https://alpha.example/", startAt: day(10), endAt: day(11), organizer: "Alpha Club",
      submissionDeadlineAt: day(11), submissionDeadlineVerified: true, submissionDeadlineSource: "https://alpha.example/rules",
      categories: ["ai", "not-a-category"], countryCode: "US", city: "Columbus", state: "Ohio",
    },
  ];

  const report = await runIngestion(db, [curatedSource, dirSource], { now: NOW, fetchImpl: fakeFetch });
  const dir = report.sources.find((s) => s.source === "dir")!;
  assert.equal(dir.rejected, 1, "record without usable dates is rejected");
  assert.equal(dir.mergedDuplicates, 1, "alpha from the directory merges into the curated event");
  assert.equal((db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n, 3);

  const statuses = Object.fromEntries((db.prepare("SELECT e.name, el.status FROM events e JOIN eligibility el ON el.event_id = e.id").all() as { name: string; status: string }[]).map((r) => [r.name, r.status]));
  assert.equal(statuses["Alpha Hacks"], "verified");
  assert.equal(statuses["Beta Hack"], "unclear", "directory listing contradicted by the official site needs review");
  assert.equal(statuses["Gamma"], "unclear", "unreachable official site can't be cross-checked");

  // Only verified eligibility is public, and higher-priority fields win.
  const pub = getPublicEvents(db, NOW);
  assert.deepEqual(pub.map((e) => e.name), ["Alpha Hacks"]);
  const alpha = pub[0]!;
  assert.equal(alpha.organizer, "Alpha Club");
  assert.equal(alpha.submissionDeadlineStatus, "verified");
  assert.deepEqual(alpha.categories, ["ai"], "unknown categories are dropped");
  assert.equal(alpha.region, "north_america");
  assert.equal(alpha.summary, "Alpha Hacks is a 24-hour hackathon for high school students in Ohio.");
  const detail = getEventDetail(db, alpha.slug)!;
  assert.ok(detail.eligibility.evidence.some((e) => e.url === "https://alpha.example/rules"), "linked rules page was checked");
  assert.equal(detail.sources.length, 2);

  // Re-ingesting updates in place: no duplicates, slug stable, interval respected.
  directoryRecords[0] = { ...directoryRecords[0]!, name: "Alpha Hacks 2026 (renamed)" };
  const second = await runIngestion(db, [curatedSource, dirSource], { now: new Date(NOW.getTime() + 3_600_000), fetchImpl: fakeFetch });
  assert.match(second.sources.find((s) => s.source === "dir")!.skipped ?? "", /minimum interval/);
  await runIngestion(db, [curatedSource, dirSource], { now: new Date(NOW.getTime() + 3_600_000), fetchImpl: fakeFetch, force: true });
  assert.equal((db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n, 3);
  assert.equal(getPublicEvents(db, NOW)[0]!.slug, alpha.slug);
  assert.equal(getPublicEvents(db, NOW)[0]!.name, "Alpha Hacks", "curated name still outranks the directory");

  // Reviewer overrides survive re-ingestion; a verified deadline needs a source.
  assert.throws(() => setOverrides(db, alpha.id, { submissionDeadlineAt: day(12), submissionDeadlineVerified: true }, null, NOW), /requires the URL/);
  setOverrides(db, alpha.id, { submissionDeadlineAt: day(-1), submissionDeadlineVerified: true, submissionDeadlineSource: "https://alpha.example/rules" }, "moved earlier", NOW);
  await runIngestion(db, [curatedSource, dirSource], { now: NOW, fetchImpl: fakeFetch, force: true });
  assert.equal(getPublicEvents(db, NOW).length, 0, "an override moving the deadline into the past closes the listing");
  assert.ok(getEventDetail(db, alpha.slug), "closed events still resolve by link");
  setOverrides(db, alpha.id, { submissionDeadlineAt: null, submissionDeadlineVerified: null, submissionDeadlineSource: null }, null, NOW);
  assert.equal(getPublicEvents(db, NOW).length, 1);

  // Manual eligibility: "verified" requires a quote; then Beta becomes public.
  const beta = db.prepare("SELECT id FROM events WHERE name = 'Beta Hack'").get() as { id: string };
  assert.throws(() => setManualEligibility(db, beta.id, { status: "verified", evidence: [{ url: "https://beta.example/" }] }, NOW), /quote/);
  setManualEligibility(db, beta.id, { status: "verified", evidence: [{ url: "https://beta.example/faq", quote: "High school students may join the open track." }] }, NOW);
  await runIngestion(db, [curatedSource, dirSource], { now: NOW, fetchImpl: fakeFetch, force: true });
  assert.ok(getPublicEvents(db, NOW).some((e) => e.name === "Beta Hack"), "manual verification survives re-ingestion");

  // Hidden events disappear from public results.
  setOverrides(db, beta.id, { hidden: true }, null, NOW);
  assert.ok(!getPublicEvents(db, NOW).some((e) => e.name === "Beta Hack"));
});

test("submissions are validated, stay private until approved, then publish with evidence", () => {
  const db = openDatabase(":memory:");
  assert.throws(() => parseSubmission({ name: "X" }), /website URL.*rules.*Quote.*start date/s);
  const input = parseSubmission({
    name: "Delta Hacks", websiteUrl: "https://delta.example/", rulesUrl: "https://delta.example/rules",
    eligibilityQuote: "Open to high school students.", startAt: day(30), format: "online",
  });
  const id = saveSubmission(db, input, NOW);
  assert.equal(getPublicEvents(db, NOW).length, 0);

  const entry = {
    name: input.name, websiteUrl: input.websiteUrl, format: "online", startAt: input.startAt, endAt: day(31),
    submissionDeadlineAt: day(31), submissionDeadlineVerified: true, submissionDeadlineSource: input.rulesUrl,
    eligibility: {
      status: "verified", highSchoolAllowed: true, educationLevels: ["high_school"], minAge: null, maxAge: null, grades: [],
      geographicRestrictions: null, internationalAllowed: null, requiresCollegeEnrollment: false, method: "submission",
      evidence: [{ url: input.rulesUrl, quote: input.eligibilityQuote }], sourceUrl: input.rulesUrl, checkedAt: NOW.toISOString(), notes: null,
    },
  };
  assert.throws(() => approveSubmission(db, id, { ...entry, eligibility: { ...entry.eligibility, evidence: [] } }, NOW), /evidence/);
  approveSubmission(db, id, entry, NOW);
  const pub = getPublicEvents(db, NOW);
  assert.deepEqual(pub.map((e) => e.name), ["Delta Hacks"]);
  assert.equal(getEventDetail(db, pub[0]!.slug)!.eligibility.method, "submission");
  assert.throws(() => approveSubmission(db, id, entry, NOW), /already reviewed/);
});

test("mock databases only ever serve mock rows", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO events (id, slug, name, format, dedupe_key, first_seen_at, created_at, updated_at, start_at, submission_deadline_at, submission_deadline_status) VALUES ('r', 'real', 'Real', 'online', 'real', ?, ?, ?, ?, ?, 'verified')").run(NOW.toISOString(), NOW.toISOString(), NOW.toISOString(), day(3), day(4));
  db.prepare("INSERT INTO eligibility (event_id, status, method, checked_at) VALUES ('r', 'verified', 'manual', ?)").run(NOW.toISOString());
  assert.equal(getPublicEvents(db, NOW).length, 1);
  setMeta(db, "mock", "1");
  assert.equal(getPublicEvents(db, NOW).length, 0, "a real row in a mock DB is not served as mock, and vice versa");
});
