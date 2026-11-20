import { useId, useMemo, useState } from "react";
import type { Facets, Filters, When } from "../../shared/filters.ts";
import { CATEGORIES, COSTS, FORMATS, GRADES, LENGTHS, PERKS, REGIONS, labelFor } from "../../shared/taxonomy.ts";
import type { EventSummary } from "../../shared/types.ts";

export type SetFilters = (patch: Partial<Filters>) => void;

interface Props {
  filters: Filters;
  setFilters: SetFilters;
  facets: Facets;
  /** Facets over the whole dataset: an option only appears if some event actually has it. */
  available: Facets;
  events: EventSummary[];
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
export const countryName = (code: string) => regionNames?.of(code) ?? code;

interface Option {
  id: string;
  label: string;
  count: number;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Check({ checked, onChange, label, count, disabled, radio, name }: {
  checked: boolean; onChange: () => void; label: string; count?: number; disabled?: boolean; radio?: boolean; name?: string;
}) {
  return (
    <label className={`option${disabled && !checked ? " disabled" : ""}`}>
      <input type={radio ? "radio" : "checkbox"} name={name} checked={checked} onChange={onChange} disabled={disabled && !checked} />
      <span className={`box${radio ? " radio" : ""}`} aria-hidden="true" />
      <span className="label">{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </label>
  );
}

function CheckList({ options, selected, onToggle, limit = 6, searchLabel }: {
  options: Option[]; selected: string[]; onToggle: (id: string) => void; limit?: number; searchLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;
  // Selected options always stay visible, even beyond the limit.
  const shown = expanded || query ? filtered : filtered.filter((o, i) => i < limit || selected.includes(o.id));
  return (
    <div>
      {searchLabel && options.length > limit && (
        <input className="input filter-search" type="search" placeholder={searchLabel} aria-label={searchLabel} value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      {shown.map((o) => (
        <Check key={o.id} checked={selected.includes(o.id)} onChange={() => onToggle(o.id)} label={o.label} count={o.count} disabled={o.count === 0} />
      ))}
      {!query && filtered.length > limit && (
        <button type="button" className="more-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show fewer" : `Show all ${filtered.length}`}
        </button>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section className="filter-group" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}

/** Options for a facet group, limited to values that exist in the data (plus anything selected). */
function facetOptions(ids: string[], facet: Map<string, number>, available: Map<string, number>, selected: string[], label: (id: string) => string): Option[] {
  return ids
    .filter((id) => available.has(id) || selected.includes(id))
    .map((id) => ({ id, label: label(id), count: facet.get(id) ?? 0 }));
}

const byCount = (a: Option, b: Option) => b.count - a.count || a.label.localeCompare(b.label);

export function FilterPanel({ filters: f, setFilters, facets, available, events }: Props) {
  const name = useId();
  const has = useMemo(() => ({
    age: events.some((e) => e.minAge !== null || e.maxAge !== null),
    grades: events.some((e) => e.grades.length > 0),
    team: events.some((e) => e.teamMin !== null || e.teamMax !== null || e.soloAllowed !== null),
    intl: events.some((e) => e.internationalAllowed === true),
  }), [events]);

  const lengths = facetOptions(LENGTHS.map((x) => x.id), facets.lengths, available.lengths, f.lengths, (id) => labelFor(LENGTHS, id));
  const formats = facetOptions(FORMATS.map((x) => x.id), facets.formats, available.formats, f.formats, (id) => labelFor(FORMATS, id));
  const regions = facetOptions(REGIONS.map((x) => x.id), facets.regions, available.regions, f.regions, (id) => labelFor(REGIONS, id));
  const countries = facetOptions([...available.countries.keys(), ...f.countries.filter((c) => !available.countries.has(c))], facets.countries, available.countries, f.countries, countryName).sort(byCount);
  const states = facetOptions([...available.states.keys()], facets.states, available.states, f.states, (s) => s).sort(byCount);
  const cities = facetOptions([...available.cities.keys()], facets.cities, available.cities, f.cities, (s) => s).sort(byCount);
  const categories = facetOptions(CATEGORIES.map((x) => x.id), facets.categories, available.categories, f.categories, (id) => labelFor(CATEGORIES, id));
  const perks = facetOptions(PERKS.map((x) => x.id), facets.perks, available.perks, f.perks, (id) => labelFor(PERKS, id));
  const costs = facetOptions(COSTS.map((x) => x.id), facets.cost, available.cost, f.cost ? [f.cost] : [], (id) => labelFor(COSTS, id));

  const hidden: string[] = [];
  if (!categories.length) hidden.push("categories");
  if (!perks.length) hidden.push("prizes and perks");
  if (!has.team) hidden.push("team size");
  if (!has.age && !has.grades) hidden.push("age and grade");

  const whenOptions: [When, string][] = [
    ["any", "Any time"],
    ["week", "Starting in the next 7 days"],
    ["month", "Starting in the next 30 days"],
    ["quarter", "Starting in the next 3 months"],
    ["custom", "Custom dates"],
  ];

  return (
    <div className="filters-inner">
      <Group title="Event dates">
        {whenOptions.map(([id, label]) => (
          <Check key={id} radio name={`${name}-when`} checked={f.when === id} onChange={() => setFilters({ when: id })} label={label} />
        ))}
        {f.when === "custom" && (
          <div className="inline-fields">
            <label className="field-sm">From<input className="input" type="date" value={f.from} max={f.to || undefined} onChange={(e) => setFilters({ from: e.target.value })} /></label>
            <label className="field-sm">To<input className="input" type="date" value={f.to} min={f.from || undefined} onChange={(e) => setFilters({ to: e.target.value })} /></label>
          </div>
        )}
      </Group>

      <Group title="Submission deadline">
        {([[null, "Any deadline"], [3, "Closes within 3 days"], [7, "Closes within 7 days"], [30, "Closes within 30 days"]] as const).map(([days, label]) => (
          <Check key={String(days)} radio name={`${name}-dl`} checked={f.deadlineDays === days} onChange={() => setFilters({ deadlineDays: days })} label={label} />
        ))}
        <div style={{ height: 6 }} />
        <Check checked={f.includeUnconfirmed} onChange={() => setFilters({ includeUnconfirmed: !f.includeUnconfirmed })} label="Include unconfirmed deadlines" />
        <p className="hint">Events whose official submission deadline hasn't been verified yet.</p>
      </Group>

      <Group title="Format">
        <CheckList options={formats} selected={f.formats} onToggle={(id) => setFilters({ formats: toggle(f.formats, id as never) })} />
      </Group>

      {lengths.length > 0 && (
        <Group title="Length">
          <CheckList options={lengths} selected={f.lengths} onToggle={(id) => setFilters({ lengths: toggle(f.lengths, id) })} />
        </Group>
      )}

      {(regions.length > 0 || countries.length > 0) && (
        <Group title="Location">
          <CheckList options={regions} selected={f.regions} onToggle={(id) => setFilters({ regions: toggle(f.regions, id) })} limit={8} />
          {countries.length > 0 && (
            <>
              <div className="hint" style={{ margin: "10px 0 4px" }}>Country</div>
              <CheckList options={countries} selected={f.countries} onToggle={(id) => setFilters({ countries: toggle(f.countries, id) })} limit={5} searchLabel="Find a country" />
            </>
          )}
          {states.length > 0 && (f.countries.length > 0 || states.length <= 12) && (
            <>
              <div className="hint" style={{ margin: "10px 0 4px" }}>State or province</div>
              <CheckList options={states} selected={f.states} onToggle={(id) => setFilters({ states: toggle(f.states, id) })} limit={5} searchLabel="Find a state" />
            </>
          )}
          {cities.length > 0 && (f.countries.length > 0 || f.states.length > 0) && (
            <>
              <div className="hint" style={{ margin: "10px 0 4px" }}>City</div>
              <CheckList options={cities} selected={f.cities} onToggle={(id) => setFilters({ cities: toggle(f.cities, id) })} limit={5} searchLabel="Find a city" />
            </>
          )}
        </Group>
      )}

      {categories.length > 0 && (
        <Group title="Category">
          <CheckList options={categories} selected={f.categories} onToggle={(id) => setFilters({ categories: toggle(f.categories, id) })} />
        </Group>
      )}

      {(perks.length > 0 || costs.length > 0) && (
        <Group title="Prizes and perks">
          <CheckList options={perks} selected={f.perks} onToggle={(id) => setFilters({ perks: toggle(f.perks, id as never) })} limit={7} />
          {costs.map((c) => (
            <Check key={c.id} checked={f.cost === c.id} onChange={() => setFilters({ cost: f.cost === c.id ? null : (c.id as never) })} label={c.label} count={c.count} disabled={c.count === 0} />
          ))}
        </Group>
      )}

      {(has.age || has.grades || has.intl || has.team) && (
        <Group title="Who can join">
          {has.age && (
            <label className="field-sm" style={{ marginBottom: 8 }}>
              My age
              <input className="input" type="number" inputMode="numeric" min={10} max={25} placeholder="e.g. 16" value={f.age ?? ""} onChange={(e) => setFilters({ age: e.target.value ? Number(e.target.value) : null })} />
            </label>
          )}
          {has.grades && GRADES.map((g) => (
            <Check key={g} checked={f.grades.includes(g)} onChange={() => setFilters({ grades: toggle(f.grades, g) })} label={`Grade ${g}`} />
          ))}
          {has.team && (
            <>
              <Check checked={f.solo} onChange={() => setFilters({ solo: !f.solo })} label="Solo participants allowed" />
              <label className="field-sm" style={{ marginTop: 8 }}>
                My team size
                <input className="input" type="number" inputMode="numeric" min={1} max={20} placeholder="e.g. 3" value={f.teamSize ?? ""} onChange={(e) => setFilters({ teamSize: e.target.value ? Number(e.target.value) : null })} />
              </label>
            </>
          )}
          {has.intl && <Check checked={f.international} onChange={() => setFilters({ international: !f.international })} label="Open to international participants" />}
          <p className="hint">Events that don't state a limit are kept.</p>
        </Group>
      )}

      {hidden.length > 0 && (
        <p className="filters-footnote">
          Filters for {hidden.join(", ")} appear once listed events have that information verified.
        </p>
      )}
    </div>
  );
}
