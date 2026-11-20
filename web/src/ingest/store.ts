import { randomUUID } from "node:crypto";
import type { DB } from "../server/db.ts";
import type { Eligibility } from "../shared/types.ts";
import type { ExistingEligibility } from "./eligibility.ts";
import { mergeRecords, type OverridableField, type RankedRecord } from "./merge.ts";
import { identifyingHost, nameKey, slugify } from "./normalize.ts";
import type { NormalizedEvent } from "./types.ts";

const DAY = 86_400_000;

const json = (v: unknown) => JSON.stringify(v ?? null);
const bool = (v: boolean | null | undefined) => (v === null || v === undefined ? null : v ? 1 : 0);

function withinDays(a: string | null | undefined, b: string | null | undefined, days: number): boolean {
  if (!a || !b) return false;
  return Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY;
}

/**
 * Finds the canonical event a record belongs to:
 *  1. the same (source, external id) seen before;
 *  2. the same identifying website host with a start date within 3 days;
 *  3. the same normalized name with a start date within 7 days.
 */
export function findExistingEvent(db: DB, r: NormalizedEvent): string | null {
  const bySource = db
    .prepare("SELECT event_id FROM event_sources WHERE source = ? AND external_id = ?")
    .get(r.source, r.externalId) as { event_id: string } | undefined;
  if (bySource) return bySource.event_id;

  const host = identifyingHost(r.websiteUrl) ?? identifyingHost(r.registrationUrl);
  if (host) {
    const rows = db.prepare("SELECT id, start_at FROM events WHERE website_host = ?").all(host) as { id: string; start_at: string | null }[];
    const match = rows.find((row) => withinDays(row.start_at, r.startAt, 3) || (!row.start_at && !r.startAt));
    if (match) return match.id;
  }
  const rows = db.prepare("SELECT id, start_at FROM events WHERE dedupe_key = ?").all(nameKey(r.name)) as { id: string; start_at: string | null }[];
  return rows.find((row) => withinDays(row.start_at, r.startAt, 7))?.id ?? null;
}

function uniqueSlug(db: DB, name: string, startAt: string | null | undefined): string {
  const year = startAt ? new Date(startAt).getUTCFullYear() : null;
  const base = slugify(year && !name.includes(String(year)) ? `${name} ${year}` : name);
  let slug = base;
  for (let i = 2; db.prepare("SELECT 1 FROM events WHERE slug = ?").get(slug); i++) slug = `${base}-${i}`;
  return slug;
}

export interface UpsertResult {
  eventId: string;
  created: boolean;
  mergedIntoExisting: boolean;
}

/** Records one source's view of an event and links it to its canonical event (creating it if new). */
export function upsertSourceRecord(db: DB, r: NormalizedEvent, raw: unknown, now: Date): UpsertResult {
  const ts = now.toISOString();
  const knownLink = db
    .prepare("SELECT event_id FROM event_sources WHERE source = ? AND external_id = ?")
    .get(r.source, r.externalId) as { event_id: string } | undefined;
  let eventId = knownLink?.event_id ?? findExistingEvent(db, r);
  let created = false;
  if (!eventId) {
    eventId = randomUUID();
    created = true;
    // Matching keys are stored immediately so later records in the same run can find this event.
    db.prepare(
      `INSERT INTO events (id, slug, name, format, dedupe_key, website_host, start_at, first_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      eventId, uniqueSlug(db, r.name, r.startAt), r.name, r.format, nameKey(r.name),
      identifyingHost(r.websiteUrl) ?? identifyingHost(r.registrationUrl), r.startAt ?? null, ts, ts, ts,
    );
  }
  const { eligibilityClaim: _claim, ...normalized } = r;
  db.prepare(
    `INSERT INTO event_sources (event_id, source, external_id, source_url, normalized, raw, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, external_id) DO UPDATE SET
       source_url = excluded.source_url, normalized = excluded.normalized, raw = excluded.raw, last_seen_at = excluded.last_seen_at`,
  ).run(eventId, r.source, r.externalId, r.sourceUrl, JSON.stringify(normalized), json(raw), ts, ts);
  return { eventId, created, mergedIntoExisting: !knownLink && !created };
}

export function loadOverrides(db: DB, eventId: string): Partial<Record<OverridableField, unknown>> {
  const rows = db.prepare("SELECT field, value FROM event_overrides WHERE event_id = ?").all(eventId) as { field: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.field, JSON.parse(r.value)]));
}

export function loadRankedRecords(db: DB, eventId: string, priorities: Record<string, number>): RankedRecord[] {
  const rows = db
    .prepare("SELECT source, normalized, last_seen_at FROM event_sources WHERE event_id = ?")
    .all(eventId) as { source: string; normalized: string; last_seen_at: string }[];
  return rows.map((row) => ({
    record: JSON.parse(row.normalized) as NormalizedEvent,
    priority: priorities[row.source] ?? 0,
    lastSeenAt: row.last_seen_at,
  }));
}

/** Rebuilds the canonical events row from all of its sources plus reviewer overrides. */
export function materializeEvent(db: DB, eventId: string, priorities: Record<string, number>, now: Date): void {
  const records = loadRankedRecords(db, eventId, priorities);
  if (!records.length) return;
  const m = mergeRecords(records, loadOverrides(db, eventId));
  if (!m.summary) m.summary = officialMetaDescription(db, m.websiteUrl ?? m.registrationUrl ?? null);
  db.prepare(
    `UPDATE events SET
      name = ?, organizer = ?, summary = ?, description = ?, website_url = ?, registration_url = ?, rules_url = ?,
      start_at = ?, end_at = ?, timezone = ?,
      registration_deadline_at = ?, registration_deadline_status = ?,
      submission_deadline_at = ?, submission_deadline_status = ?, submission_deadline_source = ?,
      format = ?, venue = ?, city = ?, state = ?, country = ?, country_code = ?, region = ?, latitude = ?, longitude = ?,
      team_min = ?, team_max = ?, solo_allowed = ?, categories = ?, technologies = ?, perks = ?, cost = ?,
      theme = ?, deliverables = ?, judging_criteria = ?, prize_summary = ?, prizes = ?, schedule = ?, logo_url = ?,
      website_host = ?, hidden = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    m.name, m.organizer ?? null, m.summary ?? null, m.description ?? null, m.websiteUrl ?? null, m.registrationUrl ?? null,
    m.rulesUrl ?? null, m.startAt ?? null, m.endAt ?? null, m.timezone ?? null,
    m.registrationDeadlineAt ?? null, m.registrationDeadlineVerified ? "verified" : "unverified",
    m.submissionDeadlineAt ?? null, m.submissionDeadlineVerified ? "verified" : "unverified", m.submissionDeadlineSource ?? null,
    m.format, m.venue ?? null, m.city ?? null, m.state ?? null, m.country ?? null, m.countryCode ?? null, m.region,
    m.latitude ?? null, m.longitude ?? null, m.teamMin ?? null, m.teamMax ?? null, bool(m.soloAllowed),
    json(m.categories ?? []), json(m.technologies ?? []), json(m.perks ?? []), m.cost ?? null,
    m.theme ?? null, m.deliverables ?? null, m.judgingCriteria ?? null, m.prizeSummary ?? null,
    m.prizes ? json(m.prizes) : null, m.schedule ? json(m.schedule) : null, m.logoUrl ?? null,
    identifyingHost(m.websiteUrl) ?? identifyingHost(m.registrationUrl), m.hidden ? 1 : 0, now.toISOString(),
    eventId,
  );
}

/** The organizer's own meta description, cached from the last official-site check. */
function officialMetaDescription(db: DB, url: string | null): string | null {
  if (!url) return null;
  const row = db.prepare("SELECT text_excerpt FROM page_checks WHERE url = ?").get(url) as { text_excerpt: string | null } | undefined;
  if (!row?.text_excerpt) return null;
  const meta = (JSON.parse(row.text_excerpt) as { metaDescription?: string | null }).metaDescription;
  // Skip framework boilerplate ("Generated by create next app") and fragments.
  if (!meta || meta.length < 25 || /create (next|react) app|vite \+|web site created using|powered by (wix|webflow)/i.test(meta)) return null;
  return meta.slice(0, 400);
}

export function loadEligibility(db: DB, eventId: string): ExistingEligibility | null {
  const row = db.prepare("SELECT * FROM eligibility WHERE event_id = ?").get(eventId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { eligibility: rowToEligibility(row), manual: row.manual === 1, contentHash: (row.content_hash as string) ?? null };
}

export function rowToEligibility(row: Record<string, unknown>): Eligibility {
  const b = (v: unknown) => (v === null || v === undefined ? null : v === 1);
  return {
    status: row.status as Eligibility["status"],
    highSchoolAllowed: b(row.high_school_allowed),
    educationLevels: JSON.parse((row.education_levels as string) ?? "[]"),
    minAge: (row.min_age as number) ?? null,
    maxAge: (row.max_age as number) ?? null,
    grades: JSON.parse((row.grades as string) ?? "[]"),
    geographicRestrictions: (row.geographic_restrictions as string) ?? null,
    internationalAllowed: b(row.international_allowed),
    requiresCollegeEnrollment: b(row.requires_college_enrollment),
    method: row.method as Eligibility["method"],
    evidence: JSON.parse((row.evidence as string) ?? "[]"),
    sourceUrl: (row.source_url as string) ?? null,
    checkedAt: row.checked_at as string,
    notes: (row.notes as string) ?? null,
    needsReview: row.needs_review === 1,
  };
}

export function saveEligibility(db: DB, eventId: string, e: Eligibility, manual: boolean, contentHash: string | null): void {
  db.prepare(
    `INSERT INTO eligibility (event_id, status, high_school_allowed, education_levels, min_age, max_age, grades,
       geographic_restrictions, international_allowed, requires_college_enrollment, method, evidence, source_url,
       content_hash, checked_at, notes, manual, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_id) DO UPDATE SET
       status = excluded.status, high_school_allowed = excluded.high_school_allowed,
       education_levels = excluded.education_levels, min_age = excluded.min_age, max_age = excluded.max_age,
       grades = excluded.grades, geographic_restrictions = excluded.geographic_restrictions,
       international_allowed = excluded.international_allowed,
       requires_college_enrollment = excluded.requires_college_enrollment, method = excluded.method,
       evidence = excluded.evidence, source_url = excluded.source_url, content_hash = excluded.content_hash,
       checked_at = excluded.checked_at, notes = excluded.notes, manual = excluded.manual,
       needs_review = excluded.needs_review`,
  ).run(
    eventId, e.status, bool(e.highSchoolAllowed), json(e.educationLevels), e.minAge, e.maxAge, json(e.grades),
    e.geographicRestrictions, bool(e.internationalAllowed), bool(e.requiresCollegeEnrollment), e.method,
    json(e.evidence), e.sourceUrl, contentHash, e.checkedAt, e.notes, manual ? 1 : 0, e.needsReview ? 1 : 0,
  );
}
