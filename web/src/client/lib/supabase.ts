import type { Eligibility, EventDetail, EventSummary, EventsResponse } from "../../shared/types.ts";
import { SOURCE_LABELS } from "../../shared/taxonomy.ts";

// Read-only access with the publishable key. Row-level security in Supabase limits it to verified,
// visible listings (and inserting pending suggestions), so it's safe to ship in the browser.
const URL_BASE = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/(rest\/v1\/?)?$/, "") ?? "";
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? "";

export const supabaseEnabled = Boolean(URL_BASE && KEY);

type Row = Record<string, unknown>;

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, "content-type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw Object.assign(new Error(body.message ?? `Request failed (${res.status})`), { status: res.status });
  }
  return (res.status === 201 || res.status === 204 ? null : await res.json()) as T;
}

const iso = (v: unknown) => (typeof v === "string" && v ? new Date(v).toISOString() : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const arr = <T = string>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Maps an events row (+ eligibility fields, flattened or embedded) to the UI's summary shape. */
export function rowToSummary(r: Row, el: Row = r): EventSummary {
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name),
    organizer: str(r.organizer),
    summary: str(r.summary),
    startAt: iso(r.start_at),
    endAt: iso(r.end_at),
    timezone: str(r.timezone),
    format: r.format as EventSummary["format"],
    city: str(r.city),
    state: str(r.state),
    country: str(r.country),
    countryCode: str(r.country_code),
    region: str(r.region),
    submissionDeadlineAt: iso(r.submission_deadline_at),
    submissionDeadlineStatus: r.submission_deadline_status === "verified" ? "verified" : "unverified",
    registrationDeadlineAt: iso(r.registration_deadline_at),
    registrationDeadlineStatus: r.registration_deadline_status === "verified" ? "verified" : "unverified",
    categories: arr(r.categories),
    technologies: arr(r.technologies),
    perks: arr(r.perks),
    cost: (str(r.cost) as EventSummary["cost"]) ?? null,
    prizeSummary: str(r.prize_summary),
    teamMin: num(r.team_min),
    teamMax: num(r.team_max),
    soloAllowed: bool(r.solo_allowed),
    minAge: num(el.min_age),
    maxAge: num(el.max_age),
    grades: arr<number>(el.grades),
    internationalAllowed: bool(el.international_allowed),
    logoUrl: str(r.logo_url),
    firstSeenAt: iso(r.first_seen_at) ?? new Date(0).toISOString(),
    updatedAt: iso(r.updated_at) ?? new Date(0).toISOString(),
    isMock: false,
  };
}

function rowToEligibility(el: Row): Eligibility {
  return {
    status: el.status as Eligibility["status"],
    highSchoolAllowed: bool(el.high_school_allowed),
    educationLevels: arr(el.education_levels),
    minAge: num(el.min_age),
    maxAge: num(el.max_age),
    grades: arr<number>(el.grades),
    geographicRestrictions: str(el.geographic_restrictions),
    internationalAllowed: bool(el.international_allowed),
    requiresCollegeEnrollment: bool(el.requires_college_enrollment),
    method: el.method as Eligibility["method"],
    evidence: arr(el.evidence),
    sourceUrl: str(el.source_url),
    checkedAt: iso(el.checked_at) ?? new Date(0).toISOString(),
    notes: str(el.notes),
    needsReview: el.needs_review === true,
  };
}

export async function fetchEventsFromSupabase(): Promise<EventsResponse> {
  const rows = await rest<Row[]>("public_events?select=*&order=start_at.asc&limit=5000");
  const lastIngestAt = rows.reduce<string | null>((max, r) => {
    const at = iso(r.last_verified_at);
    return at && (!max || at > max) ? at : max;
  }, null);
  return { generatedAt: new Date().toISOString(), mock: false, lastIngestAt, events: rows.map((r) => rowToSummary(r)) };
}

/** Detail by slug, including closed events so shared links still resolve. RLS hides unverified ones. */
export async function fetchEventFromSupabase(slug: string): Promise<{ event: EventDetail; mock: boolean }> {
  const rows = await rest<Row[]>(
    `events?slug=eq.${encodeURIComponent(slug)}&select=*,eligibility!inner(*),event_sources(source,source_url,last_seen_at)&limit=1`,
  );
  const r = rows[0];
  if (!r) throw Object.assign(new Error("No verified hackathon at this address."), { status: 404 });
  const el = (Array.isArray(r.eligibility) ? r.eligibility[0] : r.eligibility) as Row;
  const sources = arr<Row>(r.event_sources);
  return {
    mock: false,
    event: {
      ...rowToSummary(r, el),
      description: str(r.description),
      websiteUrl: str(r.website_url),
      registrationUrl: str(r.registration_url),
      rulesUrl: str(r.rules_url),
      venue: str(r.venue),
      theme: str(r.theme),
      deliverables: str(r.deliverables),
      judgingCriteria: str(r.judging_criteria),
      prizes: Array.isArray(r.prizes) ? (r.prizes as EventDetail["prizes"]) : null,
      schedule: Array.isArray(r.schedule) ? (r.schedule as EventDetail["schedule"]) : null,
      submissionDeadlineSource: str(r.submission_deadline_source),
      eligibility: rowToEligibility(el),
      sources: sources.map((s) => ({
        source: String(s.source),
        label: SOURCE_LABELS[String(s.source)] ?? String(s.source),
        url: str(s.source_url),
        fetchedAt: iso(s.last_seen_at) ?? new Date(0).toISOString(),
      })),
      lastVerifiedAt: iso(r.last_verified_at),
    },
  };
}

/** Organizer suggestions go straight into the pending queue; RLS only allows status = pending. */
export async function submitToSupabase(payload: Record<string, unknown>): Promise<{ ok: true }> {
  const { website_confirm: honeypot, contactEmail, ...rest_ } = payload;
  if (honeypot) return { ok: true }; // filled in by bots only
  await rest("submissions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ payload: { ...rest_, source: "organizer" }, contact_email: contactEmail || null }),
  });
  return { ok: true };
}
