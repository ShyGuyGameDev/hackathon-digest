import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlineLabel, formatDateTime, formatRange, listingState } from "../src/shared/dates.ts";

const NOW = new Date("2026-11-19T12:00:00Z");
const ev = (o: Partial<Parameters<typeof deadlineLabel>[0]> = {}) => ({
  submissionDeadlineAt: null,
  submissionDeadlineStatus: "unverified" as const,
  startAt: null,
  endAt: null,
  timezone: null,
  ...o,
});

test("an event starting next week whose verified deadline passed yesterday is closed", () => {
  const e = ev({ startAt: "2026-11-26T17:00:00Z", endAt: "2026-11-27T17:00:00Z", submissionDeadlineAt: "2026-11-18T12:00:00Z", submissionDeadlineStatus: "verified" });
  assert.equal(listingState(e, NOW), "closed");
});

test("a verified deadline keeps an already-started event open", () => {
  const e = ev({ startAt: "2026-11-01T00:00:00Z", submissionDeadlineAt: "2026-11-25T00:00:00Z", submissionDeadlineStatus: "verified" });
  assert.equal(listingState(e, NOW), "open");
});

test("a missing deadline is unconfirmed, never assumed open", () => {
  assert.equal(listingState(ev({ startAt: "2026-12-01T00:00:00Z", endAt: "2026-12-02T00:00:00Z" }), NOW), "unconfirmed");
  // An unverified deadline value is ignored for openness, too.
  assert.equal(listingState(ev({ startAt: "2026-12-01T00:00:00Z", submissionDeadlineAt: "2027-01-01T00:00:00Z" }), NOW), "unconfirmed");
});

test("unconfirmed events drop out once they end; dateless events are closed", () => {
  assert.equal(listingState(ev({ startAt: "2026-11-10T00:00:00Z", endAt: "2026-11-12T00:00:00Z" }), NOW), "closed");
  assert.equal(listingState(ev(), NOW), "closed");
});

test("deadline exactly now is closed (strictly after now to be open)", () => {
  assert.equal(listingState(ev({ submissionDeadlineAt: NOW.toISOString(), submissionDeadlineStatus: "verified" }), NOW), "closed");
});

test("deadline labels round down and pick the right tone", () => {
  const at = (ms: number) => ev({ submissionDeadlineAt: new Date(NOW.getTime() + ms).toISOString(), submissionDeadlineStatus: "verified" });
  const H = 3_600_000;
  assert.deepEqual(deadlineLabel(at(30 * 60_000), NOW), { text: "Closes in under an hour", tone: "urgent", closingSoon: true });
  assert.equal(deadlineLabel(at(1.5 * H), NOW).text, "Closes in 1 hour");
  assert.equal(deadlineLabel(at(23.9 * H), NOW).text, "Closes in 23 hours");
  assert.equal(deadlineLabel(at(3.9 * 24 * H), NOW).text, "Closes in 3 days");
  assert.equal(deadlineLabel(at(3.9 * 24 * H), NOW).tone, "urgent");
  assert.equal(deadlineLabel(at(6 * 24 * H), NOW).tone, "soon");
  assert.equal(deadlineLabel(at(15 * 24 * H), NOW).text, "Closes in 2 weeks");
  assert.equal(deadlineLabel(at(90 * 24 * H), NOW).text, "Closes Feb 17, 2027");
  assert.equal(deadlineLabel(ev({ startAt: "2026-12-01T00:00:00Z" }), NOW).text, "Deadline unconfirmed");
});

test("ranges and times respect the event's time zone", () => {
  // 07:30 UTC on Nov 21 is still Nov 20 in Los Angeles.
  assert.equal(formatRange("2026-11-21T07:30:00Z", "2026-11-22T20:00:00Z", "America/Los_Angeles", NOW), "Nov 20 – 22");
  assert.equal(formatRange("2026-11-21T07:30:00Z", "2026-11-22T20:00:00Z", "Asia/Tokyo", NOW), "Nov 21 – 23");
  assert.equal(formatRange("2026-11-30T12:00:00Z", "2026-12-02T12:00:00Z", "UTC", NOW), "Nov 30 – Dec 2");
  assert.equal(formatRange("2027-01-08T12:00:00Z", "2027-01-10T12:00:00Z", "UTC", NOW), "Jan 8 – 10, 2027");
  assert.match(formatDateTime("2026-11-24T20:00:00Z", "America/New_York"), /Nov 24, 2026, 3:00\s?PM EST/);
});
