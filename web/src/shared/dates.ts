import type { EventSummary } from "./types.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type ListingState = "open" | "unconfirmed" | "closed";

/**
 * Whether an event is still an opportunity at `now`, computed from dates only (no stored flags).
 * - A verified submission deadline is authoritative: open until it passes, even if the event started.
 * - Without a verified deadline the event is "unconfirmed" while it hasn't ended, and is never
 *   shown in the default results.
 * - An event with no dates at all can't be placed in time and is treated as closed.
 */
export function listingState(
  e: Pick<EventSummary, "submissionDeadlineAt" | "submissionDeadlineStatus" | "startAt" | "endAt">,
  now: Date,
): ListingState {
  if (e.submissionDeadlineStatus === "verified" && e.submissionDeadlineAt) {
    return Date.parse(e.submissionDeadlineAt) > now.getTime() ? "open" : "closed";
  }
  const ref = e.endAt ?? e.startAt;
  if (!ref) return "closed";
  return Date.parse(ref) > now.getTime() ? "unconfirmed" : "closed";
}

export type DeadlineTone = "urgent" | "soon" | "normal" | "muted";

export interface DeadlineLabel {
  text: string;
  tone: DeadlineTone;
  closingSoon: boolean;
}

/** Rounds remaining time down, so the label never promises more time than is left. */
export function deadlineLabel(
  e: Pick<EventSummary, "submissionDeadlineAt" | "submissionDeadlineStatus" | "startAt" | "endAt" | "timezone">,
  now: Date,
): DeadlineLabel {
  const state = listingState(e, now);
  if (state === "closed") return { text: "Closed", tone: "muted", closingSoon: false };
  if (state === "unconfirmed") return { text: "Deadline unconfirmed", tone: "muted", closingSoon: false };

  const diff = Date.parse(e.submissionDeadlineAt!) - now.getTime();
  if (diff < HOUR) return { text: "Closes in under an hour", tone: "urgent", closingSoon: true };
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return { text: `Closes in ${h} ${h === 1 ? "hour" : "hours"}`, tone: "urgent", closingSoon: true };
  }
  const days = Math.floor(diff / DAY);
  if (days < 14) {
    return {
      text: `Closes in ${days} ${days === 1 ? "day" : "days"}`,
      tone: days <= 3 ? "urgent" : days <= 7 ? "soon" : "normal",
      closingSoon: days <= 3,
    };
  }
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return { text: `Closes in ${weeks} weeks`, tone: "normal", closingSoon: false };
  }
  return { text: `Closes ${formatDay(e.submissionDeadlineAt!, e.timezone, now)}`, tone: "normal", closingSoon: false };
}

export function msUntilDeadline(e: Pick<EventSummary, "submissionDeadlineAt" | "submissionDeadlineStatus">, now: Date): number | null {
  if (e.submissionDeadlineStatus !== "verified" || !e.submissionDeadlineAt) return null;
  return Date.parse(e.submissionDeadlineAt) - now.getTime();
}

function parts(iso: string, tz: string | null) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz ?? undefined,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { y: p.year!, m: p.month!, d: p.day! };
}

export function formatDay(iso: string, tz: string | null, now: Date = new Date()): string {
  const p = parts(iso, tz);
  const thisYear = parts(now.toISOString(), tz).y;
  return p.y === thisYear ? `${p.m} ${p.d}` : `${p.m} ${p.d}, ${p.y}`;
}

/** "Nov 21 – 22", "Nov 30 – Dec 2", "Dec 3" (year appended when not the current year). */
export function formatRange(start: string | null, end: string | null, tz: string | null, now: Date = new Date()): string {
  if (!start) return "Dates not announced";
  const a = parts(start, tz);
  const thisYear = parts(now.toISOString(), tz).y;
  if (!end) return formatDay(start, tz, now);
  const b = parts(end, tz);
  const yearSuffix = b.y === thisYear && a.y === thisYear ? "" : `, ${b.y}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.m} ${a.d}${yearSuffix}`;
  if (a.y === b.y && a.m === b.m) return `${a.m} ${a.d} – ${b.d}${yearSuffix}`;
  if (a.y === b.y) return `${a.m} ${a.d} – ${b.m} ${b.d}${yearSuffix}`;
  return `${a.m} ${a.d}, ${a.y} – ${b.m} ${b.d}, ${b.y}`;
}

export function formatDateTime(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz ?? undefined,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** Month and day for the compact date column in listings. */
export function dateBadge(iso: string | null, tz: string | null): { month: string; day: string; weekday: string } | null {
  if (!iso) return null;
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz ?? undefined, month: "short", day: "numeric", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { month: p.month!, day: p.day!, weekday: p.weekday! };
}

/** Parses a YYYY-MM-DD string as the start (or end) of that day in the viewer's local zone. */
export function localDayBoundary(ymd: string, edge: "start" | "end"): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  if (edge === "end") d.setHours(23, 59, 59, 999);
  return d;
}

export function isValidInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

export { DAY, HOUR };
