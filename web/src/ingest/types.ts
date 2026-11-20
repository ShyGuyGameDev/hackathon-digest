import type { Cost, Eligibility, Format, Perk, Prize, ScheduleItem } from "../shared/types.ts";

/**
 * What a source module claims about high-school eligibility. A claim is an input to the
 * eligibility check, never the final answer on its own.
 */
export type EligibilityClaim =
  | {
      // The source only lists high-school events. Still cross-checked against the official site.
      kind: "curated_directory";
      directory: string;
      url: string;
      statement: string;
    }
  | {
      // A reviewer verified eligibility from the official rules (curated file, approved submission).
      kind: "attested";
      eligibility: Omit<Eligibility, "needsReview">;
    };

/** One event as described by one source, already mapped to our field names. */
export interface NormalizedEvent {
  source: string;
  externalId: string;
  sourceUrl: string | null;
  name: string;
  organizer?: string | null;
  summary?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  registrationUrl?: string | null;
  rulesUrl?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  registrationDeadlineAt?: string | null;
  registrationDeadlineVerified?: boolean;
  submissionDeadlineAt?: string | null;
  submissionDeadlineVerified?: boolean;
  submissionDeadlineSource?: string | null;
  format: Format;
  venue?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  teamMin?: number | null;
  teamMax?: number | null;
  soloAllowed?: boolean | null;
  categories?: string[];
  technologies?: string[];
  perks?: Perk[];
  cost?: Cost | null;
  theme?: string | null;
  deliverables?: string | null;
  judgingCriteria?: string | null;
  prizeSummary?: string | null;
  prizes?: Prize[] | null;
  schedule?: ScheduleItem[] | null;
  logoUrl?: string | null;
  eligibilityClaim?: EligibilityClaim;
}

export interface SourceRecord {
  record: NormalizedEvent;
  raw: unknown;
}

export interface SourceContext {
  fetch: typeof fetch;
  now: Date;
  log: (msg: string) => void;
}

export interface SourceModule {
  id: string;
  label: string;
  /** Higher wins when sources disagree. Official/reviewed data must outrank aggregators. */
  priority: number;
  /** Politeness floor between runs; the scheduler won't hit the source more often. */
  minIntervalHours: number;
  fetchRecords(ctx: SourceContext): Promise<SourceRecord[]>;
}
