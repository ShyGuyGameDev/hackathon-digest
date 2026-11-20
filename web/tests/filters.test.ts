import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS, applyFilters, computeFacets, countUnconfirmed, filtersToParams, paramsToFilters, type Filters,
} from "../src/shared/filters.ts";
import type { EventSummary } from "../src/shared/types.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

function make(id: string, o: Partial<EventSummary> = {}): EventSummary {
  return {
    id, slug: id, name: id, organizer: null, summary: null, startAt: day(5), endAt: day(6), timezone: null, format: "online",
    city: null, state: null, country: null, countryCode: null, region: null,
    submissionDeadlineAt: day(6), submissionDeadlineStatus: "verified", registrationDeadlineAt: null, registrationDeadlineStatus: "unverified",
    categories: [], technologies: [], perks: [], cost: null, prizeSummary: null, teamMin: null, teamMax: null, soloAllowed: null,
    minAge: null, maxAge: null, grades: [], internationalAllowed: null, logoUrl: null, firstSeenAt: day(-10), updatedAt: day(-1), isMock: false,
    ...o,
  };
}

const EVENTS = [
  make("ai-online", { name: "Neural Night", organizer: "Café Coders", categories: ["ai"], technologies: ["Python"], perks: ["cash_prizes", "beginner_friendly"], cost: "free", startAt: day(2), endAt: day(3), submissionDeadlineAt: day(3), firstSeenAt: day(-1) }),
  make("robotics-sj", { name: "Bot Builders", format: "in_person", city: "San Jose", state: "California", countryCode: "US", region: "north_america", categories: ["robotics", "hardware"], perks: ["cash_prizes"], startAt: day(20), endAt: day(21), submissionDeadlineAt: day(21), teamMin: 2, teamMax: 4 }),
  make("london-fin", { name: "Ledger Hack", format: "hybrid", city: "London", countryCode: "GB", region: "europe", categories: ["fintech"], startAt: day(40), endAt: day(41), submissionDeadlineAt: day(41), minAge: 16, soloAllowed: true }),
  make("closed", { name: "Yesterday Hack", startAt: day(7), endAt: day(8), submissionDeadlineAt: day(-1) }),
  make("unconfirmed", { name: "Mystery Deadline", startAt: day(9), endAt: day(10), submissionDeadlineAt: null, submissionDeadlineStatus: "unverified", categories: ["ai"] }),
];

const run = (patch: Partial<Filters>, extra: Partial<{ savedIds: Set<string> }> = {}) =>
  applyFilters(EVENTS, { ...DEFAULT_FILTERS, ...patch }, { now: NOW, ...extra }).map((e) => e.id);

test("default results exclude expired deadlines and unconfirmed deadlines", () => {
  assert.deepEqual(run({}), ["ai-online", "robotics-sj", "london-fin"]);
});

test("unconfirmed events can be opted into, expired never", () => {
  assert.deepEqual(run({ includeUnconfirmed: true }).sort(), ["ai-online", "london-fin", "robotics-sj", "unconfirmed"]);
  assert.equal(countUnconfirmed(EVENTS, { ...DEFAULT_FILTERS, categories: ["ai"] }, { now: NOW }), 1);
  assert.equal(countUnconfirmed(EVENTS, { ...DEFAULT_FILTERS, categories: ["fintech"] }, { now: NOW }), 0);
});

test("search covers names, organizers, technologies, places; ignores accents and case", () => {
  assert.deepEqual(run({ q: "cafe" }), ["ai-online"]);
  assert.deepEqual(run({ q: "python" }), ["ai-online"]);
  assert.deepEqual(run({ q: "san jose" }), ["robotics-sj"]);
  assert.deepEqual(run({ q: "LEDGER london" }), ["london-fin"]);
  assert.deepEqual(run({ q: "ledger paris" }), []);
});

test("filters combine: OR within a group, AND across groups", () => {
  assert.deepEqual(run({ formats: ["in_person", "hybrid"] }), ["robotics-sj", "london-fin"]);
  assert.deepEqual(run({ formats: ["in_person", "hybrid"], categories: ["fintech", "ai"] }), ["london-fin"]);
  assert.deepEqual(run({ categories: ["ai", "robotics"] }), ["ai-online", "robotics-sj"]);
  assert.deepEqual(run({ regions: ["europe"] }), ["london-fin"]);
  assert.deepEqual(run({ countries: ["US"], cities: ["San Jose"] }), ["robotics-sj"]);
});

test("perks require every selected perk", () => {
  assert.deepEqual(run({ perks: ["cash_prizes"] }), ["ai-online", "robotics-sj"]);
  assert.deepEqual(run({ perks: ["cash_prizes", "beginner_friendly"] }), ["ai-online"]);
  assert.deepEqual(run({ cost: "free" }), ["ai-online"]);
});

test("date windows and deadline windows", () => {
  assert.deepEqual(run({ when: "week" }), ["ai-online"]);
  assert.deepEqual(run({ when: "month" }), ["ai-online", "robotics-sj"]);
  assert.deepEqual(run({ deadlineDays: 7 }), ["ai-online"]);
  const ymd = (iso: string) => iso.slice(0, 10);
  assert.deepEqual(run({ when: "custom", from: ymd(day(15)), to: ymd(day(25)) }), ["robotics-sj"]);
});

test("who-can-join filters keep unstated limits but enforce stated ones", () => {
  assert.deepEqual(run({ age: 15 }), ["ai-online", "robotics-sj"]); // London requires 16+
  assert.deepEqual(run({ teamSize: 1 }), ["ai-online", "london-fin"]); // Bot Builders needs 2–4
  assert.deepEqual(run({ solo: true }), ["london-fin"]); // solo needs a positive statement
});

test("saved-only view", () => {
  assert.deepEqual(run({ saved: true }, { savedIds: new Set(["london-fin"]) }), ["london-fin"]);
});

test("sorting works together with filtering", () => {
  assert.deepEqual(run({ sort: "deadline", includeUnconfirmed: true }), ["ai-online", "robotics-sj", "london-fin", "unconfirmed"]);
  assert.deepEqual(run({ sort: "name" }), ["robotics-sj", "london-fin", "ai-online"]);
  assert.deepEqual(run({ sort: "newest" })[0], "ai-online");
});

test("facet counts ignore the group's own selection", () => {
  const f = computeFacets(EVENTS, { ...DEFAULT_FILTERS, formats: ["online"] }, { now: NOW });
  assert.equal(f.formats.get("in_person"), 1); // still offered while "online" is selected
  assert.equal(f.categories.get("robotics"), undefined); // other groups are narrowed by the selection
  assert.equal(f.categories.get("ai"), 1);
});

test("filters round-trip through the URL and reject junk", () => {
  const f: Filters = { ...DEFAULT_FILTERS, q: "ai club", sort: "deadline", formats: ["online", "hybrid"], countries: ["US"], perks: ["cash_prizes"], age: 15, includeUnconfirmed: true, when: "custom", from: "2026-12-01", to: "2026-12-31" };
  assert.deepEqual(paramsToFilters(filtersToParams(f)), f);
  const junk = paramsToFilters(new URLSearchParams("sort=evil&format=moon,online&age=500&closes=-3&from=yesterday"));
  assert.equal(junk.sort, "start");
  assert.deepEqual(junk.formats, ["online"]);
  assert.equal(junk.age, null);
  assert.equal(junk.deadlineDays, null);
  assert.equal(junk.from, "");
  assert.equal(filtersToParams(DEFAULT_FILTERS).toString(), "");
});
