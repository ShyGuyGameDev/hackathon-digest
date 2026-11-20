import { isValidInstant } from "../shared/dates.ts";
import { CATEGORIES, PERKS } from "../shared/taxonomy.ts";
import type { NormalizedEvent } from "./types.ts";

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "event";
}

/** Name key for duplicate detection: case, accents, punctuation and year tokens ignored. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

// Hosts shared by unrelated events, so they can't identify one.
const SHARED_HOSTS = new Set([
  "linktr.ee", "forms.gle", "docs.google.com", "sites.google.com", "bit.ly", "tinyurl.com", "lu.ma", "luma.com",
  "eventbrite.com", "instagram.com", "discord.gg", "discord.com", "x.com", "twitter.com", "facebook.com",
  "linkedin.com", "github.com", "notion.so", "devpost.com", "mlh.io", "hackclub.com", "typeform.com", "tally.so",
]);

export function identifyingHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return SHARED_HOSTS.has(host) ? null : host;
  } catch {
    return null;
  }
}

export function cleanUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const cleanText = (v: unknown, max = 20_000): string | null =>
  typeof v === "string" && v.trim() ? v.trim().replace(/\s+\n/g, "\n").slice(0, max) : null;

const cleanInt = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

const instant = (v: unknown): string | null => (isValidInstant(v) ? new Date(v).toISOString() : null);

function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ValidationResult {
  record: NormalizedEvent | null;
  warnings: string[];
}

/**
 * Sanitizes one record. Bad fields are dropped (never guessed); records that can't be placed in
 * time or named are rejected. A deadline is only "verified" if the source says so AND it's valid.
 */
export function validateRecord(input: NormalizedEvent): ValidationResult {
  const warnings: string[] = [];
  const name = cleanText(input.name, 200);
  if (!name) return { record: null, warnings: ["missing name"] };
  if (!input.externalId) return { record: null, warnings: ["missing external id"] };
  if (!["online", "in_person", "hybrid"].includes(input.format)) return { record: null, warnings: ["invalid format"] };

  const r: NormalizedEvent = { ...input, name };
  for (const key of ["startAt", "endAt", "registrationDeadlineAt", "submissionDeadlineAt"] as const) {
    const raw = input[key];
    const v = instant(raw);
    if (raw && !v) warnings.push(`${key}: invalid date ${JSON.stringify(raw)}`);
    r[key] = v;
  }
  if (r.startAt && r.endAt && Date.parse(r.endAt) < Date.parse(r.startAt)) {
    warnings.push("endAt before startAt; dropped endAt");
    r.endAt = null;
  }
  if (!r.startAt && !r.submissionDeadlineAt) return { record: null, warnings: [...warnings, "no usable dates"] };

  r.submissionDeadlineVerified = Boolean(input.submissionDeadlineVerified && r.submissionDeadlineAt);
  r.registrationDeadlineVerified = Boolean(input.registrationDeadlineVerified && r.registrationDeadlineAt);
  if (r.submissionDeadlineVerified && !cleanUrl(input.submissionDeadlineSource)) {
    warnings.push("verified submission deadline without a source URL; marked unverified");
    r.submissionDeadlineVerified = false;
  }
  r.submissionDeadlineSource = cleanUrl(input.submissionDeadlineSource);
  if (r.timezone && !isTimeZone(r.timezone)) {
    warnings.push(`invalid timezone ${r.timezone}`);
    r.timezone = null;
  }

  for (const key of ["websiteUrl", "registrationUrl", "rulesUrl", "logoUrl", "sourceUrl"] as const) {
    const raw = input[key];
    const v = cleanUrl(raw);
    if (raw && !v) warnings.push(`${key}: invalid URL`);
    r[key] = v;
  }
  for (const key of ["organizer", "summary", "venue", "city", "state", "country", "theme", "prizeSummary"] as const) {
    r[key] = cleanText(input[key], key === "summary" ? 400 : 300);
  }
  for (const key of ["description", "deliverables", "judgingCriteria"] as const) r[key] = cleanText(input[key]);
  r.countryCode = typeof input.countryCode === "string" && /^[A-Za-z]{2}$/.test(input.countryCode)
    ? input.countryCode.toUpperCase()
    : null;
  r.teamMin = cleanInt(input.teamMin, 1, 50);
  r.teamMax = cleanInt(input.teamMax, 1, 50);
  if (r.teamMin && r.teamMax && r.teamMin > r.teamMax) {
    warnings.push("teamMin > teamMax; dropped both");
    r.teamMin = r.teamMax = null;
  }
  r.soloAllowed = typeof input.soloAllowed === "boolean" ? input.soloAllowed : null;
  const categoryIds = new Set(CATEGORIES.map((c) => c.id));
  const perkIds = new Set(PERKS.map((p) => p.id));
  r.categories = (input.categories ?? []).filter((c) => categoryIds.has(c));
  r.perks = (input.perks ?? []).filter((p) => perkIds.has(p));
  r.technologies = (input.technologies ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  r.cost = input.cost === "free" || input.cost === "paid" ? input.cost : null;
  return { record: r, warnings };
}
