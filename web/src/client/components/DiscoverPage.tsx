import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_FILTERS, activeFilterCount, applyFilters, computeFacets, countUnconfirmed, filtersToParams, paramsToFilters,
  type Filters, type Sort,
} from "../../shared/filters.ts";
import { CATEGORIES, COSTS, FORMATS, LENGTHS, PERKS, REGIONS, labelFor } from "../../shared/taxonomy.ts";
import type { EventsResponse } from "../../shared/types.ts";
import { fetchEvents } from "../lib/api.ts";
import { navigate, onLinkClick, useDocumentTitle } from "../lib/router.ts";
import { useRecent, useSaved } from "../lib/storage.ts";
import { DetailPanel } from "./DetailPanel.tsx";
import { EventRow, type DateColumn } from "./EventRow.tsx";
import { FilterPanel, countryName } from "./FilterPanel.tsx";
import { FilterIcon, SearchIcon, XIcon } from "./Icons.tsx";

const PAGE = 50;

// The left column shows the date that matters for the current sort.
const DATE_COLUMN: Record<Sort, { field: DateColumn; label: string }> = {
  start: { field: "start", label: "Starts" },
  deadline: { field: "end", label: "Ends" },
  name: { field: "end", label: "Ends" },
  newest: { field: "listed", label: "Listed" },
};

function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function relativeTime(iso: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

interface Chip {
  key: string;
  label: string;
  remove: Partial<Filters>;
}

function chipsFor(f: Filters): Chip[] {
  const chips: Chip[] = [];
  const whenLabel = { week: "Starts within 7 days", month: "Starts within 30 days", quarter: "Starts within 3 months" } as const;
  if (f.when === "custom") chips.push({ key: "when", label: `Dates: ${f.from || "…"} to ${f.to || "…"}`, remove: { when: "any", from: "", to: "" } });
  else if (f.when !== "any") chips.push({ key: "when", label: whenLabel[f.when], remove: { when: "any" } });
  if (f.deadlineDays !== null) chips.push({ key: "dl", label: `Closes within ${f.deadlineDays} days`, remove: { deadlineDays: null } });
  if (f.includeUnconfirmed) chips.push({ key: "unc", label: "Including unconfirmed deadlines", remove: { includeUnconfirmed: false } });
  for (const x of f.formats) chips.push({ key: `f-${x}`, label: labelFor(FORMATS, x), remove: { formats: f.formats.filter((v) => v !== x) } });
  for (const x of f.lengths) chips.push({ key: `l-${x}`, label: `Length: ${labelFor(LENGTHS, x)}`, remove: { lengths: f.lengths.filter((v) => v !== x) } });
  for (const x of f.regions) chips.push({ key: `r-${x}`, label: labelFor(REGIONS, x), remove: { regions: f.regions.filter((v) => v !== x) } });
  for (const x of f.countries) chips.push({ key: `c-${x}`, label: countryName(x), remove: { countries: f.countries.filter((v) => v !== x) } });
  for (const x of f.states) chips.push({ key: `s-${x}`, label: x, remove: { states: f.states.filter((v) => v !== x) } });
  for (const x of f.cities) chips.push({ key: `ci-${x}`, label: x, remove: { cities: f.cities.filter((v) => v !== x) } });
  for (const x of f.categories) chips.push({ key: `cat-${x}`, label: labelFor(CATEGORIES, x), remove: { categories: f.categories.filter((v) => v !== x) } });
  for (const x of f.perks) chips.push({ key: `p-${x}`, label: labelFor(PERKS, x), remove: { perks: f.perks.filter((v) => v !== x) } });
  if (f.cost) chips.push({ key: "cost", label: labelFor(COSTS, f.cost), remove: { cost: null } });
  if (f.age !== null) chips.push({ key: "age", label: `Age ${f.age}`, remove: { age: null } });
  for (const g of f.grades) chips.push({ key: `g-${g}`, label: `Grade ${g}`, remove: { grades: f.grades.filter((v) => v !== g) } });
  if (f.solo) chips.push({ key: "solo", label: "Solo allowed", remove: { solo: false } });
  if (f.teamSize !== null) chips.push({ key: "team", label: `Team of ${f.teamSize}`, remove: { teamSize: null } });
  if (f.international) chips.push({ key: "intl", label: "International", remove: { international: false } });
  if (f.saved) chips.push({ key: "saved", label: "Saved only", remove: { saved: false } });
  return chips;
}

export function DiscoverPage({ path, search, onToast }: { path: string; search: string; onToast: (m: string) => void }) {
  const [data, setData] = useState<EventsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const now = useNow();
  const { saved, toggle } = useSaved();
  const recent = useRecent();

  const filters = useMemo(() => paramsToFilters(new URLSearchParams(search)), [search]);
  const slug = /^\/e\/([a-z0-9-]+)$/.exec(path)?.[1] ?? null;
  const query = search && search !== "?" ? search : "";

  const load = useCallback(() => {
    fetchEvents()
      .then((d) => {
        setData(d);
        setLoadError(null);
      })
      .catch(() => setLoadError("We couldn't load hackathons right now."));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 5 * 60_000);
    return () => clearInterval(id);
  }, [load]);

  const setFilters = useCallback((patch: Partial<Filters>) => {
    const next = filtersToParams({ ...paramsToFilters(new URLSearchParams(window.location.search)), ...patch }).toString();
    navigate(`${window.location.pathname}${next ? `?${next}` : ""}`, { replace: true });
    setLimit(PAGE);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const events = data?.events ?? [];
  const deferred = useDeferredValue(filters);
  const ctx = useMemo(() => ({ now, savedIds: saved }), [now, saved]);
  const results = useMemo(() => applyFilters(events, deferred, ctx), [events, deferred, ctx]);
  const facets = useMemo(() => computeFacets(events, deferred, ctx), [events, deferred, ctx]);
  const available = useMemo(() => computeFacets(events, { ...DEFAULT_FILTERS, includeUnconfirmed: true }, { now }), [events, now]);
  const unconfirmed = useMemo(() => countUnconfirmed(events, deferred, ctx), [events, deferred, ctx]);
  const chips = chipsFor(filters);
  const filterCount = activeFilterCount(filters);
  const preview = slug ? events.find((e) => e.slug === slug) : undefined;
  const recentEvents = recent.map((s) => events.find((e) => e.slug === s)).filter((e) => e !== undefined).slice(0, 5);

  useDocumentTitle(preview ? `${preview.name} · Hackathon Digest` : "Hackathons for high school students · Hackathon Digest");

  // Load the next page when the sentinel scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && setLimit((l) => l + PAGE), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [results.length > limit]);

  const closeDetail = useCallback(() => navigate(`/${query}`), [query]);
  const panel = (
    <FilterPanel filters={filters} setFilters={setFilters} facets={facets} available={available} events={events} />
  );

  return (
    <main id="main" className="page">
      <div className="intro">
        <h1>Hackathons open to high school students</h1>
        <p>
          {data ? `${events.length} upcoming worldwide, each checked for high school eligibility` : "Loading…"}
          {data?.lastIngestAt && ` · updated ${relativeTime(data.lastIngestAt, now)}`}
        </p>
      </div>

      <div className="search" role="search">
        <SearchIcon />
        <label htmlFor="q" className="visually-hidden">Search hackathons</label>
        <input
          id="q"
          ref={searchRef}
          type="search"
          autoComplete="off"
          placeholder="Search by name, organizer, city, theme or technology"
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
        />
        {filters.q ? (
          <button type="button" className="icon-btn clear" aria-label="Clear search" onClick={() => { setFilters({ q: "" }); searchRef.current?.focus(); }}><XIcon /></button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>

      <div className="layout">
        <nav className="filters desktop" aria-label="Filters">
          {panel}
          {recentEvents.length > 0 && (
            <section className="filter-group">
              <h3>Recently viewed</h3>
              {recentEvents.map((e) => (
                <a key={e.id} className="option" style={{ textDecoration: "none" }} href={`/e/${e.slug}${query}`} onClick={(ev) => onLinkClick(ev, `/e/${e.slug}${query}`)}>
                  <span className="label">{e.name}</span>
                </a>
              ))}
            </section>
          )}
        </nav>

        <section aria-label="Results">
          <div className="toolbar">
            <button type="button" className="btn small mobile-only" onClick={() => setSheetOpen(true)}>
              <FilterIcon /> Filters{filterCount ? ` (${filterCount})` : ""}
            </button>
            <p className="result-count" aria-live="polite">
              {data ? <>{results.length} {results.length === 1 ? "hackathon" : "hackathons"}</> : " "}
            </p>
            <span className="spacer" />
            <label className="sort">
              Sort
              <select className="select" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as Sort })}>
                <option value="start">Start date</option>
                <option value="deadline">Deadline</option>
                <option value="newest">Newly listed</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>

          {chips.length > 0 && (
            <div className="chips">
              {chips.map((c) => (
                <button key={c.key} type="button" className="chip" onClick={() => setFilters(c.remove)} aria-label={`Remove filter: ${c.label}`}>
                  {c.label} <XIcon size={13} />
                </button>
              ))}
              <button type="button" className="link-btn" onClick={() => setFilters({ ...DEFAULT_FILTERS, q: filters.q, sort: filters.sort })}>Clear all</button>
            </div>
          )}

          <div className="list" role="list" aria-busy={!data}>
            {!data && !loadError && Array.from({ length: 6 }, (_, i) => (
              <div className="row" key={i} role="listitem" aria-hidden="true">
                <div className="skeleton" style={{ height: 34, width: 34, margin: "0 auto" }} />
                <div><div className="skeleton" style={{ width: "45%" }} /><div className="skeleton" style={{ width: "70%", marginTop: 8 }} /></div>
              </div>
            ))}
            {loadError && (
              <div className="empty" role="listitem">
                <h2>Something went wrong</h2>
                <p>{loadError}</p>
                <button type="button" className="btn" onClick={load}>Try again</button>
              </div>
            )}
            {data && results.length === 0 && (
              <div className="empty" role="listitem">
                {unconfirmed > 0 ? (
                  <>
                    <h2>No matches with a verified submission deadline</h2>
                    <p>
                      {unconfirmed} upcoming {unconfirmed === 1 ? "hackathon matches" : "hackathons match"} but {unconfirmed === 1 ? "its" : "their"} submission deadline hasn't been verified yet.
                      Check the official site before planning around {unconfirmed === 1 ? "it" : "them"}.
                    </p>
                    <button type="button" className="btn primary" onClick={() => setFilters({ includeUnconfirmed: true })}>
                      Show {unconfirmed} {unconfirmed === 1 ? "event" : "events"} with unconfirmed deadlines
                    </button>
                  </>
                ) : filterCount || filters.q ? (
                  <>
                    <h2>No hackathons match</h2>
                    <p>Try removing a filter or searching for something broader.</p>
                    <button type="button" className="btn" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear search and filters</button>
                  </>
                ) : (
                  <>
                    <h2>No verified hackathons right now</h2>
                    <p>New events are checked several times a day. Know of one? <a href="/submit" onClick={(e) => onLinkClick(e, "/submit")}>Suggest it</a>.</p>
                  </>
                )}
              </div>
            )}
            {results.length > 0 && (
              <div className="list-head" aria-hidden="true">
                <span>{DATE_COLUMN[filters.sort].label}</span><span>Hackathon</span><span className="h-where">Format and location</span><span style={{ textAlign: "right" }}>Submissions</span>
              </div>
            )}
            {results.slice(0, limit).map((e) => (
              <EventRow
                dateColumn={DATE_COLUMN[filters.sort].field}
                key={e.id}
                event={e}
                now={now}
                selected={e.slug === slug}
                saved={saved.has(e.id)}
                href={`/e/${e.slug}${query}`}
                onToggleSave={toggle}
              />
            ))}
            {results.length > limit && (
              <>
                <div ref={sentinel} />
                <button type="button" className="load-more" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more ({results.length - limit} remaining)
                </button>
              </>
            )}
            {results.length > 0 && unconfirmed > 0 && (
              <div className="notice" role="listitem">
                <p>{unconfirmed} more {unconfirmed === 1 ? "event has" : "events have"} no verified submission deadline yet.</p>
                <button type="button" className="btn small" onClick={() => setFilters({ includeUnconfirmed: true })}>Show them</button>
              </div>
            )}
          </div>
        </section>
      </div>

      {slug && (
        <DetailPanel
          key={slug}
          slug={slug}
          preview={preview}
          now={now}
          saved={preview ? saved.has(preview.id) : false}
          onToggleSave={toggle}
          onClose={closeDetail}
          onToast={onToast}
        />
      )}

      {sheetOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Filters" onKeyDown={(e) => e.key === "Escape" && setSheetOpen(false)}>
            <div className="sheet-head">
              <h2>Filters</h2>
              <button type="button" className="icon-btn" onClick={() => setSheetOpen(false)} aria-label="Close filters"><XIcon /></button>
            </div>
            <div className="sheet-body"><div className="filters">{panel}</div></div>
            <div className="sheet-foot">
              <button type="button" className="btn" onClick={() => setFilters({ ...DEFAULT_FILTERS, q: filters.q, sort: filters.sort })}>Clear all</button>
              <button type="button" className="btn primary" onClick={() => setSheetOpen(false)}>Show {results.length} results</button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
