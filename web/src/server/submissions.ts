import { isValidInstant } from "../shared/dates.ts";
import { cleanUrl } from "../ingest/normalize.ts";
import type { DB } from "./db.ts";
import { HttpError } from "./admin.ts";

export interface SubmissionInput {
  name: string;
  organizer: string | null;
  websiteUrl: string;
  registrationUrl: string | null;
  rulesUrl: string;
  eligibilityQuote: string;
  startAt: string;
  endAt: string | null;
  submissionDeadlineAt: string | null;
  format: "online" | "in_person" | "hybrid";
  city: string | null;
  country: string | null;
  description: string | null;
  contactEmail: string | null;
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Validates an organizer suggestion. Nothing here is trusted; a reviewer re-checks every field. */
export function parseSubmission(body: Record<string, unknown>): SubmissionInput {
  const errors: string[] = [];
  const name = text(body.name, 200);
  const websiteUrl = cleanUrl(body.websiteUrl);
  const rulesUrl = cleanUrl(body.rulesUrl);
  const eligibilityQuote = text(body.eligibilityQuote, 1000);
  const startAt = isValidInstant(body.startAt) ? new Date(body.startAt).toISOString() : null;
  const endAt = isValidInstant(body.endAt) ? new Date(body.endAt).toISOString() : null;
  const deadline = isValidInstant(body.submissionDeadlineAt) ? new Date(body.submissionDeadlineAt).toISOString() : null;
  const format = ["online", "in_person", "hybrid"].includes(body.format as string) ? (body.format as SubmissionInput["format"]) : null;
  const email = text(body.contactEmail, 200);

  if (!name) errors.push("Event name is required.");
  if (!websiteUrl) errors.push("A valid official website URL is required.");
  if (!rulesUrl) errors.push("Link the official rules or eligibility page.");
  if (!eligibilityQuote) errors.push("Quote the rule that allows high school students.");
  if (!startAt) errors.push("A valid start date is required.");
  if (startAt && endAt && endAt < startAt) errors.push("End date is before the start date.");
  if (!format) errors.push("Choose online, in person or hybrid.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Contact email looks invalid.");
  if (errors.length) throw new HttpError(400, errors.join(" "));

  return {
    name: name!,
    organizer: text(body.organizer, 200),
    websiteUrl: websiteUrl!,
    registrationUrl: cleanUrl(body.registrationUrl),
    rulesUrl: rulesUrl!,
    eligibilityQuote: eligibilityQuote!,
    startAt: startAt!,
    endAt,
    submissionDeadlineAt: deadline,
    format: format!,
    city: text(body.city, 120),
    country: text(body.country, 120),
    description: text(body.description, 4000),
    contactEmail: email,
  };
}

export function saveSubmission(db: DB, input: SubmissionInput, now: Date): number {
  const res = db
    .prepare("INSERT INTO submissions (created_at, status, payload, contact_email) VALUES (?, 'pending', ?, ?)")
    .run(now.toISOString(), JSON.stringify(input), input.contactEmail);
  return Number(res.lastInsertRowid);
}

// Small in-memory limiter: plenty for a single-instance deployment.
const hits = new Map<string, number[]>();
export function allowSubmission(ip: string, now: number, limit = 5, windowMs = 3_600_000): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}
