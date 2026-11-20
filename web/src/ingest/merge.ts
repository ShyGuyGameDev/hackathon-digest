import { regionForCountry } from "../shared/taxonomy.ts";
import type { NormalizedEvent } from "./types.ts";

/** Fields a reviewer may override from the admin dashboard. */
export const OVERRIDABLE_FIELDS = [
  "name", "organizer", "summary", "description", "websiteUrl", "registrationUrl", "rulesUrl",
  "startAt", "endAt", "timezone", "registrationDeadlineAt", "registrationDeadlineVerified",
  "submissionDeadlineAt", "submissionDeadlineVerified", "submissionDeadlineSource",
  "format", "venue", "city", "state", "country", "countryCode",
  "teamMin", "teamMax", "soloAllowed", "categories", "technologies", "perks", "cost",
  "theme", "deliverables", "judgingCriteria", "prizeSummary", "prizes", "schedule",
  "hidden",
] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

export interface RankedRecord {
  record: NormalizedEvent;
  priority: number;
  lastSeenAt: string;
}

type Merged = Omit<NormalizedEvent, "source" | "externalId" | "sourceUrl" | "eligibilityClaim"> & {
  region: string | null;
  hidden: boolean;
};

const SCALARS = [
  "name", "organizer", "summary", "description", "websiteUrl", "registrationUrl", "rulesUrl", "startAt", "endAt",
  "timezone", "format", "venue", "city", "state", "country", "countryCode", "latitude", "longitude", "teamMin",
  "teamMax", "soloAllowed", "cost", "theme", "deliverables", "judgingCriteria", "prizeSummary", "prizes",
  "schedule", "logoUrl",
] as const;
const LISTS = ["categories", "technologies", "perks"] as const;

const present = (v: unknown) => v !== undefined && v !== null && v !== "";

/**
 * Field-level merge: for each field the highest-priority source that has a value wins (ties go to
 * the most recently seen record). Deadlines travel with their verification flag and source, so a
 * verified deadline from any source beats an unverified one. Reviewer overrides are applied last.
 */
export function mergeRecords(records: RankedRecord[], overrides: Partial<Record<OverridableField, unknown>>): Merged {
  const ranked = [...records].sort(
    (a, b) => b.priority - a.priority || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt),
  );
  const out: Record<string, unknown> = {};
  for (const key of SCALARS) out[key] = ranked.map((r) => r.record[key]).find(present) ?? null;
  for (const key of LISTS) out[key] = ranked.map((r) => r.record[key]).find((v) => Array.isArray(v) && v.length) ?? [];

  const deadline = (atKey: "submissionDeadlineAt" | "registrationDeadlineAt", flag: "submissionDeadlineVerified" | "registrationDeadlineVerified") => {
    const verified = ranked.find((r) => r.record[flag] && r.record[atKey]);
    const any = verified ?? ranked.find((r) => r.record[atKey]);
    return { at: any?.record[atKey] ?? null, verified: Boolean(verified), from: any };
  };
  const sub = deadline("submissionDeadlineAt", "submissionDeadlineVerified");
  out.submissionDeadlineAt = sub.at;
  out.submissionDeadlineVerified = sub.verified;
  out.submissionDeadlineSource = sub.verified ? (sub.from?.record.submissionDeadlineSource ?? null) : null;
  const reg = deadline("registrationDeadlineAt", "registrationDeadlineVerified");
  out.registrationDeadlineAt = reg.at;
  out.registrationDeadlineVerified = reg.verified;
  out.hidden = false;

  for (const [field, value] of Object.entries(overrides)) {
    if ((OVERRIDABLE_FIELDS as readonly string[]).includes(field)) out[field] = value;
  }
  // Online events have no physical location; a stray organizer address would pollute location filters.
  if (out.format === "online") {
    out.city = out.state = out.venue = out.country = out.countryCode = null;
    out.latitude = out.longitude = null;
  }
  out.region = regionForCountry(out.countryCode as string | null);
  return out as Merged;
}
