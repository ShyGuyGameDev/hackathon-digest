import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeText, decideEligibility, type PageEvidence } from "../src/ingest/eligibility.ts";
import { parseRobots, robotsAllows } from "../src/ingest/fetchPage.ts";
import type { EligibilityClaim } from "../src/ingest/types.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const page = (text: string, o: Partial<PageEvidence> = {}): PageEvidence => ({
  url: "https://example.org/", ok: true, error: null, contentHash: "h1", pages: [{ url: "https://example.org/", text }], ...o,
});
const directory: EligibilityClaim = { kind: "curated_directory", directory: "HS Directory", url: "https://dir.example/", statement: "Listed as a high school hackathon." };

test("recognises explicit high school wording", () => {
  for (const text of [
    "A 24-hour hackathon for high school students in Ohio.",
    "Open to all high schoolers!",
    "Students in grades 9-12 are welcome.",
    "Participants ages 13 – 18.",
    "Open to secondary school students across the UK.",
    "Free, beginner-friendly hackathons for teens aged 13–18.",
  ]) {
    assert.ok(analyzeText([{ url: "u", text }]).positive.length > 0, text);
  }
});

test("recognises exclusions without tripping on prize-age clauses", () => {
  for (const text of [
    "This event is open only to university students.",
    "You must be currently enrolled at an accredited university.",
    "Registration requires a valid .edu email address.",
    "All participants must be at least 18 years old.",
    "High school students are not eligible.",
  ]) {
    assert.ok(analyzeText([{ url: "u", text }]).negative.length > 0, text);
  }
  for (const text of ["Winners must be 18 to receive cash prizes.", "Participants must be 18 or under.", "College students welcome too."]) {
    assert.equal(analyzeText([{ url: "u", text }]).negative.length, 0, text);
  }
});

test("extracts a stated age range", () => {
  const a = analyzeText([{ url: "u", text: "Open to ages 14-19." }]);
  assert.equal(a.minAge, 14);
  assert.equal(a.maxAge, 19);
});

test("directory listing + reachable official site without contradictions → verified", () => {
  const d = decideEligibility(directory, page("Join us for 24 hours of building."), null, NOW);
  assert.equal(d.eligibility.status, "verified");
  assert.equal(d.eligibility.method, "curated_directory");
  assert.equal(d.eligibility.evidence[0]?.url, "https://dir.example/");
});

test("official site unreachable → unclear, even with a directory listing", () => {
  const d = decideEligibility(directory, page("", { ok: false, error: "HTTP 503", pages: [] }), null, NOW);
  assert.equal(d.eligibility.status, "unclear");
  assert.match(d.eligibility.notes ?? "", /503/);
});

test("exclusion with no positive signal → ineligible; conflicting signals → unclear for review", () => {
  assert.equal(decideEligibility(undefined, page("Open only to university students."), null, NOW).eligibility.status, "ineligible");
  const conflicting = decideEligibility(directory, page("Open only to university students."), null, NOW).eligibility;
  assert.equal(conflicting.status, "unclear");
  assert.equal(conflicting.needsReview, true);
});

test("no directory and no explicit wording → unclear (never assumed)", () => {
  assert.equal(decideEligibility(undefined, page("A weekend of hacking. Prizes!"), null, NOW).eligibility.status, "unclear");
  assert.equal(decideEligibility(undefined, page("Calling all high school students!"), null, NOW).eligibility.status, "verified");
});

test("manual decisions stand but are flagged when the official page changes", () => {
  const manual = {
    eligibility: { ...decideEligibility(directory, page("x"), null, NOW).eligibility, method: "manual" as const },
    manual: true,
    contentHash: "h1",
  };
  const same = decideEligibility(directory, page("Open only to university students.", { contentHash: "h1" }), manual, NOW);
  assert.equal(same.eligibility.status, "verified");
  assert.equal(same.eligibility.needsReview, false);
  const changed = decideEligibility(directory, page("new text", { contentHash: "h2" }), manual, NOW);
  assert.equal(changed.eligibility.needsReview, true);
  assert.equal(changed.manual, true);
});

test("robots.txt rules", () => {
  const rules = parseRobots("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\nDisallow: /*.pdf$\n");
  assert.deepEqual(rules, ["/private", "/*.pdf$"]);
  assert.equal(robotsAllows(rules, "/"), true);
  assert.equal(robotsAllows(rules, "/private/x"), false);
  assert.equal(robotsAllows(rules, "/rules.pdf"), false);
  assert.equal(robotsAllows(rules, "/rules.pdf.html"), true);
  assert.deepEqual(parseRobots("User-agent: HackathonDigestBot\nDisallow: /\nUser-agent: *\nDisallow:\n"), ["/"]);
});
