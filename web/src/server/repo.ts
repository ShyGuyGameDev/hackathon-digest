import { listingState } from "../shared/dates.ts";
import type { EventDetail, EventSummary } from "../shared/types.ts";
import { rowToEligibility } from "../ingest/store.ts";
import { SOURCE_LABELS } from "../ingest/sources/index.ts";
import { isMockDatabase, type DB } from "./db.ts";

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => (v === null || v === undefined ? null : v === 1);
const list = <T = string>(v: unknown): T[] => (typeof v === "string" ? (JSON.parse(v) as T[]) : []);

export function rowToSummary(r: Row): EventSummary {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    organizer: str(r.organizer),
    summary: str(r.summary),
    startAt: str(r.start_at),
    endAt: str(r.end_at),
    timezone: str(r.timezone),
    format: r.format as EventSummary["format"],
    city: str(r.city),
    state: str(r.state),
    country: str(r.country),
    countryCode: str(r.country_code),
    region: str(r.region),
    submissionDeadlineAt: str(r.submission_deadline_at),
    submissionDeadlineStatus: r.submission_deadline_status === "verified" ? "verified" : "unverified",
    registrationDeadlineAt: str(r.registration_deadline_at),
    registrationDeadlineStatus: r.registration_deadline_status === "verified" ? "verified" : "unverified",
    categories: list(r.categories),
    technologies: list(r.technologies),
    perks: list(r.perks),
    cost: (r.cost as EventSummary["cost"]) ?? null,
    prizeSummary: str(r.prize_summary),
    teamMin: num(r.team_min),
    teamMax: num(r.team_max),
    soloAllowed: bool(r.solo_allowed),
    minAge: num(r.el_min_age),
    maxAge: num(r.el_max_age),
    grades: list<number>(r.el_grades),
    internationalAllowed: bool(r.el_international_allowed),
    logoUrl: str(r.logo_url),
    firstSeenAt: String(r.first_seen_at),
    updatedAt: String(r.updated_at),
    isMock: r.is_mock === 1,
  };
}

const PUBLIC_SELECT = `
  SELECT e.*, el.min_age AS el_min_age, el.max_age AS el_max_age, el.grades AS el_grades,
         el.international_allowed AS el_international_allowed
  FROM events e JOIN eligibility el ON el.event_id = e.id
  WHERE el.status = 'verified' AND e.hidden = 0 AND e.is_mock = ?`;

/** Every event a visitor may see right now: verified-eligible, not hidden, not closed. */
export function getPublicEvents(db: DB, now: Date): EventSummary[] {
  const rows = db.prepare(PUBLIC_SELECT).all(isMockDatabase(db) ? 1 : 0) as Row[];
  return rows.map(rowToSummary).filter((e) => listingState(e, now) !== "closed");
}

/** Detail for a shareable link. Closed events still resolve so old links explain what happened. */
export function getEventDetail(db: DB, slug: string): EventDetail | null {
  const row = db.prepare(`${PUBLIC_SELECT} AND e.slug = ?`).get(isMockDatabase(db) ? 1 : 0, slug) as Row | undefined;
  if (!row) return null;
  return toDetail(db, row);
}

export function toDetail(db: DB, row: Row): EventDetail {
  const el = db.prepare("SELECT * FROM eligibility WHERE event_id = ?").get(row.id as string) as Row;
  const sources = db
    .prepare("SELECT source, source_url, last_seen_at FROM event_sources WHERE event_id = ? ORDER BY last_seen_at DESC")
    .all(row.id as string) as Row[];
  return {
    ...rowToSummary(row),
    description: str(row.description),
    websiteUrl: str(row.website_url),
    registrationUrl: str(row.registration_url),
    rulesUrl: str(row.rules_url),
    venue: str(row.venue),
    theme: str(row.theme),
    deliverables: str(row.deliverables),
    judgingCriteria: str(row.judging_criteria),
    prizes: row.prizes ? JSON.parse(row.prizes as string) : null,
    schedule: row.schedule ? JSON.parse(row.schedule as string) : null,
    submissionDeadlineSource: str(row.submission_deadline_source),
    eligibility: rowToEligibility(el),
    sources: sources.map((s) => ({
      source: String(s.source),
      label: SOURCE_LABELS[String(s.source)] ?? String(s.source),
      url: str(s.source_url),
      fetchedAt: String(s.last_seen_at),
    })),
    lastVerifiedAt: str(row.last_verified_at),
  };
}

export function lastIngestAt(db: DB): string | null {
  const row = db.prepare("SELECT MAX(finished_at) AS at FROM ingestion_runs WHERE status = 'succeeded'").get() as { at: string | null };
  return row.at;
}
