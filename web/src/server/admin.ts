import { listingState } from "../shared/dates.ts";
import type { EducationLevel, Eligibility, EligibilityStatus, Evidence } from "../shared/types.ts";
import { OVERRIDABLE_FIELDS } from "../ingest/merge.ts";
import { cleanUrl, validateRecord } from "../ingest/normalize.ts";
import { parseCuratedEntry } from "../ingest/sources/curated.ts";
import { SOURCE_PRIORITIES } from "../ingest/sources/index.ts";
import { loadEligibility, materializeEvent, saveEligibility, upsertSourceRecord } from "../ingest/store.ts";
import { transaction, type DB } from "./db.ts";
import { rowToSummary, toDetail } from "./repo.ts";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const bad = (msg: string) => new HttpError(400, msg);

export function listAdminEvents(db: DB, now: Date) {
  const rows = db
    .prepare(
      `SELECT e.*, el.status AS el_status, el.needs_review AS el_needs_review, el.manual AS el_manual,
              el.notes AS el_notes, el.checked_at AS el_checked_at, el.min_age AS el_min_age, el.max_age AS el_max_age,
              el.grades AS el_grades, el.international_allowed AS el_international_allowed,
              (SELECT group_concat(source) FROM event_sources s WHERE s.event_id = e.id) AS source_ids
       FROM events e LEFT JOIN eligibility el ON el.event_id = e.id
       ORDER BY e.start_at`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    ...rowToSummary(r),
    hidden: r.hidden === 1,
    eligibilityStatus: (r.el_status as EligibilityStatus | null) ?? null,
    eligibilityNeedsReview: r.el_needs_review === 1,
    eligibilityManual: r.el_manual === 1,
    eligibilityNotes: (r.el_notes as string | null) ?? null,
    eligibilityCheckedAt: (r.el_checked_at as string | null) ?? null,
    listingState: listingState(rowToSummary(r), now),
    sources: String(r.source_ids ?? "").split(",").filter(Boolean),
  }));
}

export function getAdminEvent(db: DB, id: string) {
  const row = db
    .prepare(
      `SELECT e.*, el.min_age AS el_min_age, el.max_age AS el_max_age, el.grades AS el_grades,
              el.international_allowed AS el_international_allowed
       FROM events e LEFT JOIN eligibility el ON el.event_id = e.id WHERE e.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) throw new HttpError(404, "Event not found");
  const hasEligibility = db.prepare("SELECT 1 FROM eligibility WHERE event_id = ?").get(id);
  const overrides = db.prepare("SELECT field, value, note, updated_at FROM event_overrides WHERE event_id = ?").all(id) as Record<string, string>[];
  const sources = db.prepare("SELECT source, external_id, source_url, normalized, last_seen_at FROM event_sources WHERE event_id = ?").all(id) as Record<string, string>[];
  return {
    event: hasEligibility ? toDetail(db, row) : { ...rowToSummary(row), eligibility: null },
    hidden: row.hidden === 1,
    overrides: overrides.map((o) => ({ field: o.field, value: JSON.parse(o.value!), note: o.note, updatedAt: o.updated_at })),
    sources: sources.map((s) => ({ source: s.source, externalId: s.external_id, sourceUrl: s.source_url, lastSeenAt: s.last_seen_at, record: JSON.parse(s.normalized!) })),
  };
}

/** Sets (or, with null, clears) reviewer overrides, then rebuilds the canonical record. */
export function setOverrides(db: DB, id: string, overrides: Record<string, unknown>, note: string | null, now: Date): void {
  if (!db.prepare("SELECT 1 FROM events WHERE id = ?").get(id)) throw new HttpError(404, "Event not found");
  for (const field of Object.keys(overrides)) {
    if (!(OVERRIDABLE_FIELDS as readonly string[]).includes(field)) throw bad(`Field "${field}" cannot be overridden`);
  }
  if (overrides.submissionDeadlineVerified === true && !cleanUrl(overrides.submissionDeadlineSource)) {
    throw bad("Confirming a submission deadline requires the URL of the page that states it");
  }
  const current = db.prepare("SELECT name, format FROM events WHERE id = ?").get(id) as { name: string; format: string };
  // Run the same validation as ingestion so reviewers can't store malformed dates or URLs.
  const probe = { source: "override", externalId: id, sourceUrl: null, name: current.name, format: current.format, startAt: "2000-01-01T00:00:00Z", ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== null)) };
  const { record, warnings } = validateRecord(probe as never);
  if (!record || warnings.length) throw bad(`Invalid override: ${[...warnings].join("; ") || "rejected"}`);
  transaction(db, () => {
    for (const [field, value] of Object.entries(overrides)) {
      if (value === null) db.prepare("DELETE FROM event_overrides WHERE event_id = ? AND field = ?").run(id, field);
      else
        db.prepare(
          `INSERT INTO event_overrides (event_id, field, value, note, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (event_id, field) DO UPDATE SET value = excluded.value, note = excluded.note, updated_at = excluded.updated_at`,
        ).run(id, field, JSON.stringify(value), note, now.toISOString());
    }
    materializeEvent(db, id, SOURCE_PRIORITIES, now);
  });
}

const LEVELS: EducationLevel[] = ["middle_school", "high_school", "undergraduate", "graduate", "anyone"];

/** A reviewer's eligibility decision. "verified" must cite the official page and quote it. */
export function setManualEligibility(db: DB, id: string, input: Record<string, unknown>, now: Date): void {
  if (!db.prepare("SELECT 1 FROM events WHERE id = ?").get(id)) throw new HttpError(404, "Event not found");
  const status = input.status as EligibilityStatus;
  if (!["verified", "unclear", "ineligible"].includes(status)) throw bad("status must be verified, unclear or ineligible");
  const evidence: Evidence[] = [];
  for (const raw of Array.isArray(input.evidence) ? (input.evidence as Partial<Evidence>[]) : []) {
    const url = cleanUrl(raw?.url);
    if (!url) continue;
    const item: Evidence = { url };
    if (typeof raw.quote === "string" && raw.quote.trim()) item.quote = raw.quote.trim().slice(0, 600);
    if (typeof raw.note === "string" && raw.note.trim()) item.note = raw.note.trim().slice(0, 200);
    evidence.push(item);
  }
  if (status === "verified" && !evidence.some((e) => e.quote)) {
    throw bad("Verified eligibility needs at least one official URL with a quote of the rule that allows high school students");
  }
  const int = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null);
  const tri = (v: unknown) => (v === true ? true : v === false ? false : null);
  const previous = loadEligibility(db, id);
  const e: Eligibility = {
    status,
    highSchoolAllowed: status === "verified" ? true : status === "ineligible" ? false : null,
    educationLevels: (Array.isArray(input.educationLevels) ? input.educationLevels : []).filter((l: EducationLevel) => LEVELS.includes(l)),
    minAge: int(input.minAge, 5, 99),
    maxAge: int(input.maxAge, 5, 99),
    grades: (Array.isArray(input.grades) ? input.grades : []).filter((g: number) => Number.isInteger(g) && g >= 6 && g <= 12),
    geographicRestrictions: typeof input.geographicRestrictions === "string" && input.geographicRestrictions.trim() ? input.geographicRestrictions.trim() : null,
    internationalAllowed: tri(input.internationalAllowed),
    requiresCollegeEnrollment: tri(input.requiresCollegeEnrollment),
    method: "manual",
    evidence,
    sourceUrl: evidence[0]?.url ?? null,
    checkedAt: now.toISOString(),
    notes: typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null,
    needsReview: false,
  };
  saveEligibility(db, id, e, true, previous?.contentHash ?? null);
}

export function listSubmissions(db: DB) {
  const rows = db.prepare("SELECT * FROM submissions ORDER BY status = 'pending' DESC, created_at DESC").all() as Record<string, unknown>[];
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload as string) }));
}

/**
 * Approves a submission. The reviewer sends the final, researched record in the curated format
 * (same validation as data/curated), which is stored as a "submission" source record.
 */
export function approveSubmission(db: DB, submissionId: number, entry: Record<string, unknown>, now: Date): string {
  const sub = db.prepare("SELECT * FROM submissions WHERE id = ?").get(submissionId) as Record<string, unknown> | undefined;
  if (!sub) throw new HttpError(404, "Submission not found");
  if (sub.status !== "pending") throw bad("Submission was already reviewed");
  let parsed;
  try {
    parsed = parseCuratedEntry({ ...entry, externalId: `submission-${submissionId}` } as never, "submission");
  } catch (err) {
    throw bad(err instanceof Error ? err.message : String(err));
  }
  const { record: valid, warnings } = validateRecord({ ...parsed.record, source: "submission" });
  if (!valid) throw bad(`Invalid event: ${warnings.join("; ")}`);
  return transaction(db, () => {
    const { eventId } = upsertSourceRecord(db, valid, entry, now);
    materializeEvent(db, eventId, SOURCE_PRIORITIES, now);
    if (valid.eligibilityClaim?.kind === "attested") {
      saveEligibility(db, eventId, { ...valid.eligibilityClaim.eligibility, needsReview: false }, true, null);
    }
    db.prepare("UPDATE events SET last_verified_at = ? WHERE id = ?").run(now.toISOString(), eventId);
    db.prepare("UPDATE submissions SET status = 'approved', reviewed_at = ?, event_id = ? WHERE id = ?").run(now.toISOString(), eventId, submissionId);
    return eventId;
  });
}

export function rejectSubmission(db: DB, submissionId: number, note: string | null, now: Date): void {
  const res = db
    .prepare("UPDATE submissions SET status = 'rejected', review_note = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .run(note, now.toISOString(), submissionId);
  if (res.changes === 0) throw new HttpError(404, "No pending submission with that id");
}

export function listRuns(db: DB) {
  return (db.prepare("SELECT * FROM ingestion_runs ORDER BY id DESC LIMIT 50").all() as Record<string, unknown>[]).map((r) => ({
    ...r,
    stats: r.stats ? JSON.parse(r.stats as string) : null,
  }));
}
