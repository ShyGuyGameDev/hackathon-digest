import { DAY, listingState, localDayBoundary, msUntilDeadline } from "./dates.ts";
import type { Cost, EventSummary, Format, Perk } from "./types.ts";

export type When = "any" | "week" | "month" | "quarter" | "custom";
export type Sort = "start" | "deadline" | "newest" | "name";

export interface Filters {
  q: string;
  sort: Sort;
  when: When;
  from: string; // YYYY-MM-DD, used when when === "custom"
  to: string;
  deadlineDays: number | null; // verified deadline within N days
  includeUnconfirmed: boolean;
  formats: Format[];
  regions: string[];
  countries: string[];
  states: string[];
  cities: string[];
  categories: string[];
  perks: Perk[];
  cost: Cost | null;
  age: number | null;
  grades: number[];
  international: boolean;
  solo: boolean;
  teamSize: number | null;
  saved: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  sort: "start",
  when: "any",
  from: "",
  to: "",
  deadlineDays: null,
  includeUnconfirmed: false,
  formats: [],
  regions: [],
  countries: [],
  states: [],
  cities: [],
  categories: [],
  perks: [],
  cost: null,
  age: null,
  grades: [],
  international: false,
  solo: false,
  teamSize: null,
  saved: false,
};

export interface FilterContext {
  now: Date;
  savedIds?: ReadonlySet<string>;
}

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const blobCache = new WeakMap<EventSummary, string>();
function searchBlob(e: EventSummary): string {
  let blob = blobCache.get(e);
  if (blob === undefined) {
    blob = normalize(
      [e.name, e.organizer, e.summary, e.city, e.state, e.country, e.prizeSummary, ...e.categories, ...e.technologies]
        .filter(Boolean)
        .join(" \u0000 "),
    );
    blobCache.set(e, blob);
  }
  return blob;
}

export function matchesSearch(e: EventSummary, q: string): boolean {
  const tokens = normalize(q).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const blob = searchBlob(e);
  return tokens.every((t) => blob.includes(t));
}

type Group = "formats" | "regions" | "countries" | "states" | "cities" | "categories" | "perks" | "cost";

/** Applies every filter except `skip` (used to compute facet counts for that group). */
function passes(e: EventSummary, f: Filters, ctx: FilterContext, skip?: Group): boolean {
  const state = listingState(e, ctx.now);
  if (state === "closed") return false;
  if (state === "unconfirmed" && !f.includeUnconfirmed) return false;

  if (f.saved && !ctx.savedIds?.has(e.id)) return false;
  if (!matchesSearch(e, f.q)) return false;

  const start = e.startAt ? Date.parse(e.startAt) : null;
  const end = e.endAt && start !== null ? Math.max(Date.parse(e.endAt), start) : start;
  const now = ctx.now.getTime();
  if (f.when === "week" || f.when === "month" || f.when === "quarter") {
    const horizon = now + (f.when === "week" ? 7 : f.when === "month" ? 30 : 90) * DAY;
    if (start === null || start < now || start > horizon) return false;
  } else if (f.when === "custom") {
    const from = f.from ? localDayBoundary(f.from, "start") : null;
    const to = f.to ? localDayBoundary(f.to, "end") : null;
    if (start === null) return false;
    if (from && (end ?? start) < from.getTime()) return false;
    if (to && start > to.getTime()) return false;
  }

  if (f.deadlineDays !== null) {
    const left = msUntilDeadline(e, ctx.now);
    if (left === null || left > f.deadlineDays * DAY) return false;
  }

  if (skip !== "formats" && f.formats.length && !f.formats.includes(e.format)) return false;
  if (skip !== "regions" && f.regions.length && !(e.region && f.regions.includes(e.region))) return false;
  if (skip !== "countries" && f.countries.length && !(e.countryCode && f.countries.includes(e.countryCode))) return false;
  if (skip !== "states" && f.states.length && !(e.state && f.states.includes(e.state))) return false;
  if (skip !== "cities" && f.cities.length && !(e.city && f.cities.includes(e.city))) return false;
  if (skip !== "categories" && f.categories.length && !f.categories.some((c) => e.categories.includes(c))) return false;
  if (skip !== "perks" && f.perks.length && !f.perks.every((p) => e.perks.includes(p))) return false;
  if (skip !== "cost" && f.cost && e.cost !== f.cost) return false;

  // "Can I take part?" filters: an unstated limit doesn't exclude, a stated one must fit.
  if (f.age !== null) {
    if (e.minAge !== null && e.minAge > f.age) return false;
    if (e.maxAge !== null && e.maxAge < f.age) return false;
  }
  if (f.grades.length && e.grades.length && !f.grades.some((g) => e.grades.includes(g))) return false;
  if (f.teamSize !== null) {
    if (e.teamMin !== null && e.teamMin > f.teamSize) return false;
    if (e.teamMax !== null && e.teamMax < f.teamSize) return false;
  }
  // These two require a positive, verified statement.
  if (f.solo && !(e.soloAllowed === true || e.teamMin === 1)) return false;
  if (f.international && e.internationalAllowed !== true) return false;

  return true;
}

function compare(sort: Sort, now: Date) {
  const startOf = (e: EventSummary) => (e.startAt ? Date.parse(e.startAt) : Number.POSITIVE_INFINITY);
  return (a: EventSummary, b: EventSummary): number => {
    switch (sort) {
      case "deadline": {
        const da = msUntilDeadline(a, now) ?? Number.POSITIVE_INFINITY;
        const db = msUntilDeadline(b, now) ?? Number.POSITIVE_INFINITY;
        return da - db || startOf(a) - startOf(b) || a.name.localeCompare(b.name);
      }
      case "newest":
        return Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt) || a.name.localeCompare(b.name);
      case "name":
        return a.name.localeCompare(b.name);
      case "start":
      default:
        return startOf(a) - startOf(b) || a.name.localeCompare(b.name);
    }
  };
}

export function applyFilters(events: EventSummary[], f: Filters, ctx: FilterContext): EventSummary[] {
  return events.filter((e) => passes(e, f, ctx)).sort(compare(f.sort, ctx.now));
}

/** Number of open events that only lack a confirmed deadline, given the other filters. */
export function countUnconfirmed(events: EventSummary[], f: Filters, ctx: FilterContext): number {
  if (f.includeUnconfirmed) return 0;
  const withUnconfirmed = { ...f, includeUnconfirmed: true };
  return events.filter((e) => listingState(e, ctx.now) === "unconfirmed" && passes(e, withUnconfirmed, ctx)).length;
}

export type Facets = Record<Group, Map<string, number>>;

/** Counts per option, each group computed with its own selection ignored (standard faceted search). */
export function computeFacets(events: EventSummary[], f: Filters, ctx: FilterContext): Facets {
  const facets: Facets = {
    formats: new Map(),
    regions: new Map(),
    countries: new Map(),
    states: new Map(),
    cities: new Map(),
    categories: new Map(),
    perks: new Map(),
    cost: new Map(),
  };
  const bump = (m: Map<string, number>, k: string | null) => {
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const e of events) {
    if (passes(e, f, ctx, "formats")) bump(facets.formats, e.format);
    if (passes(e, f, ctx, "regions")) bump(facets.regions, e.region);
    if (passes(e, f, ctx, "countries")) bump(facets.countries, e.countryCode);
    if (passes(e, f, ctx, "states")) bump(facets.states, e.state);
    if (passes(e, f, ctx, "cities")) bump(facets.cities, e.city);
    if (passes(e, f, ctx, "categories")) for (const c of e.categories) bump(facets.categories, c);
    if (passes(e, f, ctx, "perks")) for (const p of e.perks) bump(facets.perks, p);
    if (passes(e, f, ctx, "cost")) bump(facets.cost, e.cost);
  }
  return facets;
}

// ---- URL query-string round trip -------------------------------------------------------------

const LIST_KEYS = {
  formats: "format",
  regions: "region",
  countries: "country",
  states: "state",
  cities: "city",
  categories: "cat",
  perks: "perk",
} as const;

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  if (f.when !== "any") p.set("when", f.when);
  if (f.when === "custom") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  if (f.deadlineDays !== null) p.set("closes", String(f.deadlineDays));
  if (f.includeUnconfirmed) p.set("unconfirmed", "1");
  for (const [field, key] of Object.entries(LIST_KEYS)) {
    const values = f[field as keyof typeof LIST_KEYS] as string[];
    if (values.length) p.set(key, values.join(","));
  }
  if (f.cost) p.set("cost", f.cost);
  if (f.age !== null) p.set("age", String(f.age));
  if (f.grades.length) p.set("grade", f.grades.join(","));
  if (f.international) p.set("intl", "1");
  if (f.solo) p.set("solo", "1");
  if (f.teamSize !== null) p.set("team", String(f.teamSize));
  if (f.saved) p.set("saved", "1");
  return p;
}

const SORTS: Sort[] = ["start", "deadline", "newest", "name"];
const WHENS: When[] = ["any", "week", "month", "quarter", "custom"];
const FORMAT_IDS: Format[] = ["online", "in_person", "hybrid"];

function intParam(p: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = p.get(key);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function paramsToFilters(p: URLSearchParams): Filters {
  const list = (key: string) => (p.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const sort = p.get("sort") as Sort;
  const when = p.get("when") as When;
  const cost = p.get("cost");
  return {
    ...DEFAULT_FILTERS,
    q: p.get("q") ?? "",
    sort: SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    when: WHENS.includes(when) ? when : "any",
    from: /^\d{4}-\d{2}-\d{2}$/.test(p.get("from") ?? "") ? p.get("from")! : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(p.get("to") ?? "") ? p.get("to")! : "",
    deadlineDays: intParam(p, "closes", 1, 365),
    includeUnconfirmed: p.get("unconfirmed") === "1",
    formats: list("format").filter((x): x is Format => FORMAT_IDS.includes(x as Format)),
    regions: list("region"),
    countries: list("country").map((c) => c.toUpperCase()),
    states: list("state"),
    cities: list("city"),
    categories: list("cat"),
    perks: list("perk") as Perk[],
    cost: cost === "free" || cost === "paid" ? cost : null,
    age: intParam(p, "age", 5, 99),
    grades: list("grade").map(Number).filter((g) => Number.isInteger(g) && g >= 6 && g <= 12),
    international: p.get("intl") === "1",
    solo: p.get("solo") === "1",
    teamSize: intParam(p, "team", 1, 50),
    saved: p.get("saved") === "1",
  };
}

/** Number of active narrowing filters (search and sort excluded), for badges like "Filters (3)". */
export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.when !== "any") n++;
  if (f.deadlineDays !== null) n++;
  if (f.includeUnconfirmed) n++;
  n += f.formats.length + f.regions.length + f.countries.length + f.states.length + f.cities.length;
  n += f.categories.length + f.perks.length + f.grades.length;
  if (f.cost) n++;
  if (f.age !== null) n++;
  if (f.international) n++;
  if (f.solo) n++;
  if (f.teamSize !== null) n++;
  if (f.saved) n++;
  return n;
}
