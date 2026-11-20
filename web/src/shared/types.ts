// Domain types shared by the server, the ingestion pipeline and the browser.
// All instants are ISO-8601 UTC strings. `null` always means "not verified / not known",
// never "false" — the UI must show it as unavailable, not as a negative.

export type Format = "online" | "in_person" | "hybrid";

export type EligibilityStatus = "verified" | "unclear" | "ineligible";

export type DeadlineStatus = "verified" | "unverified";

export type EligibilityMethod =
  | "curated_directory" // listed by a directory that only lists high-school events, cross-checked against the official site
  | "official_site" // explicit wording found on the official site
  | "manual" // a reviewer checked the official rules
  | "submission"; // organizer submission, approved by a reviewer

export type EducationLevel = "middle_school" | "high_school" | "undergraduate" | "graduate" | "anyone";

export type Perk =
  | "cash_prizes"
  | "scholarships"
  | "internships"
  | "hardware_prizes"
  | "travel_assistance"
  | "accommodation"
  | "beginner_friendly";

export type Cost = "free" | "paid";

export interface Evidence {
  url: string;
  quote?: string;
  note?: string;
}

export interface Eligibility {
  status: EligibilityStatus;
  highSchoolAllowed: boolean | null;
  educationLevels: EducationLevel[];
  minAge: number | null;
  maxAge: number | null;
  /** US-style grades 9–12 when the organizer restricts by grade; empty = not restricted / not stated. */
  grades: number[];
  geographicRestrictions: string | null;
  internationalAllowed: boolean | null;
  requiresCollegeEnrollment: boolean | null;
  method: EligibilityMethod;
  evidence: Evidence[];
  sourceUrl: string | null;
  checkedAt: string;
  notes: string | null;
  /** Set when the official page changed after a manual verification. */
  needsReview: boolean;
}

export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  organizer: string | null;
  summary: string | null;
  startAt: string | null;
  endAt: string | null;
  /** IANA zone of the event when known; otherwise dates are shown in the viewer's zone. */
  timezone: string | null;
  format: Format;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  region: string | null;
  submissionDeadlineAt: string | null;
  submissionDeadlineStatus: DeadlineStatus;
  registrationDeadlineAt: string | null;
  registrationDeadlineStatus: DeadlineStatus;
  categories: string[];
  technologies: string[];
  perks: Perk[];
  cost: Cost | null;
  prizeSummary: string | null;
  teamMin: number | null;
  teamMax: number | null;
  soloAllowed: boolean | null;
  minAge: number | null;
  maxAge: number | null;
  grades: number[];
  internationalAllowed: boolean | null;
  logoUrl: string | null;
  firstSeenAt: string;
  updatedAt: string;
  isMock: boolean;
}

export interface Prize {
  name: string;
  amount?: string;
  description?: string;
}

export interface ScheduleItem {
  at: string;
  label: string;
}

export interface SourceRef {
  source: string;
  label: string;
  url: string | null;
  fetchedAt: string;
}

export interface EventDetail extends EventSummary {
  description: string | null;
  websiteUrl: string | null;
  registrationUrl: string | null;
  rulesUrl: string | null;
  venue: string | null;
  theme: string | null;
  deliverables: string | null;
  judgingCriteria: string | null;
  prizes: Prize[] | null;
  schedule: ScheduleItem[] | null;
  submissionDeadlineSource: string | null;
  eligibility: Eligibility;
  sources: SourceRef[];
  lastVerifiedAt: string | null;
}

export interface EventsResponse {
  generatedAt: string;
  mock: boolean;
  lastIngestAt: string | null;
  events: EventSummary[];
}
