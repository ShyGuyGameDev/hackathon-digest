import { useCallback, useEffect, useState } from "react";
import { formatDateTime, formatRange } from "../../shared/dates.ts";
import { CATEGORIES, EDUCATION_LEVELS, PERKS } from "../../shared/taxonomy.ts";
import type { EligibilityStatus, EventDetail, EventSummary } from "../../shared/types.ts";
import { adminRequest } from "../lib/api.ts";
import { useDocumentTitle } from "../lib/router.ts";

type AdminEvent = EventSummary & {
  hidden: boolean;
  eligibilityStatus: EligibilityStatus | null;
  eligibilityNeedsReview: boolean;
  eligibilityManual: boolean;
  eligibilityNotes: string | null;
  listingState: "open" | "unconfirmed" | "closed";
  sources: string[];
};
type AdminEventDetail = {
  event: EventDetail;
  hidden: boolean;
  overrides: { field: string; value: unknown; note: string | null; updatedAt: string }[];
  sources: { source: string; externalId: string; sourceUrl: string | null; lastSeenAt: string; record: unknown }[];
};
type Submission = { id: number; created_at: string; status: string; payload: Record<string, string | null>; review_note: string | null; event_id: string | null };
type Run = { id: number; source: string; started_at: string; finished_at: string | null; status: string; stats: Record<string, unknown> | null; error: string | null };

const TOKEN_KEY = "hd.adminToken";
const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
};

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function AdminPage() {
  useDocumentTitle("Admin · Hackathon Digest");
  const [token, setToken] = useState(readToken);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"review" | "all" | "submissions" | "runs">("review");
  const [events, setEvents] = useState<AdminEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(<T,>(path: string, method?: string, body?: unknown) => adminRequest<T>(token, path, method, body), [token]);

  const refresh = useCallback(() => {
    if (!token) return;
    call<{ events: AdminEvent[] }>("/events")
      .then((r) => {
        setEvents(r.events);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
        if (err.status === 401) {
          setToken("");
          try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
        }
      });
  }, [call, token]);
  useEffect(refresh, [refresh]);

  if (!token) {
    return (
      <main id="main" className="narrow">
        <h1>Admin</h1>
        <p className="sub">Enter the ADMIN_TOKEN configured on the server. It's kept for this browser tab only.</p>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          try { sessionStorage.setItem(TOKEN_KEY, draft); } catch { /* ignore */ }
          setToken(draft);
        }}>
          <label className="field"><span>Admin token</span><input className="input" type="password" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="current-password" required /></label>
          {error && <p className="alert error">{error}</p>}
          <div><button className="btn primary" type="submit">Continue</button></div>
        </form>
      </main>
    );
  }

  const review = (events ?? []).filter((e) => e.listingState !== "closed" && (e.eligibilityStatus !== "verified" || e.eligibilityNeedsReview || e.listingState === "unconfirmed"));
  const shown = tab === "review" ? review : events ?? [];

  return (
    <main id="main" className="admin">
      <h1 style={{ fontSize: 20 }}>Admin</h1>
      {error && <p className="alert error" style={{ marginTop: 12 }}>{error}</p>}
      <div className="tabs" role="tablist">
        {([["review", `Needs review (${review.length})`], ["all", `All events (${events?.length ?? 0})`], ["submissions", "Submissions"], ["runs", "Ingestion"]] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setSelected(null); }}>{label}</button>
        ))}
      </div>

      {(tab === "review" || tab === "all") && (selected ? (
        <EventEditor id={selected} call={call} onBack={() => { setSelected(null); refresh(); }} />
      ) : (
        <table className="table">
          <thead><tr><th>Event</th><th>Dates</th><th>Eligibility</th><th>Deadline</th><th>Listing</th><th>Sources</th></tr></thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => setSelected(e.id)}>
                <td><strong>{e.name}</strong>{e.hidden && <span className="status" style={{ marginLeft: 6 }}>hidden</span>}<div style={{ color: "var(--text-3)" }}>{e.city ?? (e.format === "online" ? "Online" : "")} {e.countryCode ?? ""}</div></td>
                <td className="num">{formatRange(e.startAt, e.endAt, e.timezone)}</td>
                <td>
                  <span className={`status ${e.eligibilityStatus ?? ""}`}>{e.eligibilityStatus ?? "unchecked"}</span>
                  {e.eligibilityNeedsReview && <span className="status unclear" style={{ marginLeft: 4 }}>page changed</span>}
                  {e.eligibilityNotes && <div style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>{e.eligibilityNotes}</div>}
                </td>
                <td><span className={`status ${e.submissionDeadlineStatus === "verified" ? "verified" : "unclear"}`}>{e.submissionDeadlineStatus}</span></td>
                <td><span className={`status ${e.listingState}`}>{e.listingState}</span></td>
                <td>{e.sources.join(", ")}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} style={{ color: "var(--text-3)" }}>{events ? "Nothing here." : "Loading…"}</td></tr>}
          </tbody>
        </table>
      ))}

      {tab === "submissions" && <Submissions call={call} />}
      {tab === "runs" && <Runs call={call} />}
    </main>
  );
}

type Call = <T>(path: string, method?: string, body?: unknown) => Promise<T>;

function useFeedback() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };
  const view = msg && <p className={`alert ${msg.ok ? "ok" : "error"}`} style={{ marginTop: 10 }}>{msg.text}</p>;
  return { run, view };
}

function EventEditor({ id, call, onBack }: { id: string; call: Call; onBack: () => void }) {
  const [data, setData] = useState<AdminEventDetail | null>(null);
  const load = useCallback(() => call<AdminEventDetail>(`/events/${id}`).then(setData), [call, id]);
  useEffect(() => void load(), [load]);
  const deadlineFb = useFeedback();
  const eligFb = useFeedback();
  const detailsFb = useFeedback();

  if (!data) return <p>Loading…</p>;
  const e = data.event;
  const el = e.eligibility;

  const patch = (overrides: Record<string, unknown>, note?: string) =>
    call<AdminEventDetail>(`/events/${id}`, "PATCH", { overrides, note: note ?? null }).then(setData);

  return (
    <div>
      <button className="btn small" onClick={onBack}>← Back</button>
      <h2 style={{ margin: "14px 0 4px", fontSize: 18 }}>{e.name}</h2>
      <p style={{ color: "var(--text-3)", marginBottom: 16 }}>
        {formatRange(e.startAt, e.endAt, e.timezone)} · {e.format} · {e.websiteUrl && <a href={e.websiteUrl} target="_blank" rel="noopener noreferrer">{e.websiteUrl}</a>}
        {" · "}<a href={`/e/${e.slug}`} target="_blank" rel="noopener noreferrer">public page</a>
      </p>
      <div className="editor">
        <form className="card form" onSubmit={(ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          deadlineFb.run(() => patch({
            submissionDeadlineAt: fromLocalInput(String(f.get("at"))),
            submissionDeadlineVerified: true,
            submissionDeadlineSource: String(f.get("source")) || null,
          }, "Deadline confirmed by reviewer"), "Deadline confirmed.");
        }}>
          <h3>Submission deadline</h3>
          <p style={{ color: "var(--text-2)" }}>Currently: {e.submissionDeadlineStatus === "verified" && e.submissionDeadlineAt ? `${formatDateTime(e.submissionDeadlineAt, e.timezone)} (verified)` : "not verified"}</p>
          <label className="field"><span>Submissions close (your local time)</span><input className="input" name="at" type="datetime-local" required defaultValue={toLocalInput(e.submissionDeadlineAt)} key={e.submissionDeadlineAt ?? "none"} /></label>
          <label className="field"><span>Official page that states it</span><input className="input" name="source" type="url" required defaultValue={e.submissionDeadlineSource ?? e.rulesUrl ?? e.websiteUrl ?? ""} /></label>
          <small style={{ color: "var(--text-3)" }}>For short in-person events where submissions close when the event ends, enter the end time ({e.endAt ? formatDateTime(e.endAt, e.timezone) : "unknown"}) only if the official schedule confirms it.</small>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary small" type="submit">Confirm deadline</button>
            <button className="btn small" type="button" onClick={() => deadlineFb.run(() => patch({ submissionDeadlineAt: null, submissionDeadlineVerified: null, submissionDeadlineSource: null }), "Override cleared.")}>Clear override</button>
          </div>
          {deadlineFb.view}
        </form>

        <form className="card form" onSubmit={(ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          const num = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
          const intl = String(f.get("intl"));
          eligFb.run(() => call(`/events/${id}/eligibility`, "PUT", {
            status: f.get("status"),
            evidence: [{ url: f.get("url"), quote: f.get("quote") }],
            educationLevels: f.getAll("levels"),
            minAge: num("minAge"),
            maxAge: num("maxAge"),
            geographicRestrictions: f.get("geo") || null,
            internationalAllowed: intl === "yes" ? true : intl === "no" ? false : null,
            notes: f.get("notes") || null,
          }).then(load), "Eligibility saved.");
        }}>
          <h3>Eligibility</h3>
          <p style={{ color: "var(--text-2)" }}>Currently <span className={`status ${el?.status}`}>{el?.status ?? "unchecked"}</span> via {el?.method}{el?.needsReview ? " — official page changed since manual review" : ""}</p>
          {el?.evidence.map((ev, i) => <p key={i} style={{ fontSize: 12.5, color: "var(--text-3)" }}>{ev.quote ? `“${ev.quote}”` : ev.note} — {ev.url}</p>)}
          <label className="field"><span>Decision</span>
            <select className="select input" name="status" defaultValue={el?.status ?? "unclear"}>
              <option value="verified">Verified: high school students can participate</option>
              <option value="unclear">Unclear: hold back</option>
              <option value="ineligible">Ineligible: excludes high school students</option>
            </select>
          </label>
          <label className="field"><span>Official rules URL</span><input className="input" name="url" type="url" required defaultValue={e.rulesUrl ?? el?.sourceUrl ?? e.websiteUrl ?? ""} /></label>
          <label className="field"><span>Exact quote from the rules</span><textarea className="input" name="quote" rows={2} required={false} placeholder="Required for “verified”" /></label>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 10 }}>
            {EDUCATION_LEVELS.map((l) => <label key={l.id} style={{ display: "flex", gap: 4 }}><input type="checkbox" name="levels" value={l.id} defaultChecked={el?.educationLevels.includes(l.id)} />{l.label}</label>)}
          </fieldset>
          <div className="row2">
            <label className="field"><span>Min age</span><input className="input" name="minAge" type="number" min={5} max={99} defaultValue={el?.minAge ?? ""} /></label>
            <label className="field"><span>Max age</span><input className="input" name="maxAge" type="number" min={5} max={99} defaultValue={el?.maxAge ?? ""} /></label>
          </div>
          <div className="row2">
            <label className="field"><span>Geographic restrictions</span><input className="input" name="geo" defaultValue={el?.geographicRestrictions ?? ""} /></label>
            <label className="field"><span>International participants</span>
              <select className="select input" name="intl" defaultValue={el?.internationalAllowed === true ? "yes" : el?.internationalAllowed === false ? "no" : ""}>
                <option value="">Not stated</option><option value="yes">Allowed</option><option value="no">Not allowed</option>
              </select>
            </label>
          </div>
          <label className="field"><span>Notes</span><input className="input" name="notes" defaultValue={el?.notes ?? ""} /></label>
          <div><button className="btn primary small" type="submit">Save eligibility</button></div>
          {eligFb.view}
        </form>

        <form className="card form" style={{ gridColumn: "1 / -1" }} onSubmit={(ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          const text = (k: string) => (String(f.get(k) ?? "").trim() || null);
          const int = (k: string) => (f.get(k) ? Number(f.get(k)) : null);
          const solo = String(f.get("solo"));
          const cost = String(f.get("cost"));
          const next: Record<string, unknown> = {
            organizer: text("organizer"), summary: text("summary"), registrationUrl: text("registrationUrl"), rulesUrl: text("rulesUrl"),
            theme: text("theme"), prizeSummary: text("prizeSummary"), description: text("description"), deliverables: text("deliverables"),
            judgingCriteria: text("judgingCriteria"), teamMin: int("teamMin"), teamMax: int("teamMax"),
            soloAllowed: solo === "yes" ? true : solo === "no" ? false : null, cost: cost || null,
            categories: f.getAll("categories").length ? f.getAll("categories") : null,
            perks: f.getAll("perks").length ? f.getAll("perks") : null,
            timezone: text("timezone"),
          };
          // Send only what changed, so untouched fields keep following the sources.
          const norm = (v: unknown) => JSON.stringify(Array.isArray(v) && v.length === 0 ? null : v ?? null);
          const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => norm(v) !== norm((e as unknown as Record<string, unknown>)[k])));
          detailsFb.run(() => (Object.keys(changed).length ? patch(changed, "Details edited by reviewer") : Promise.resolve()), "Details saved.");
        }}>
          <h3>Verified details <small style={{ fontWeight: 400, color: "var(--text-3)" }}>Only enter what the official site states. Empty = use source data.</small></h3>
          <div className="row2">
            <label className="field"><span>Organizer</span><input className="input" name="organizer" defaultValue={e.organizer ?? ""} /></label>
            <label className="field"><span>Event time zone (IANA, e.g. America/Los_Angeles)</span><input className="input" name="timezone" defaultValue={e.timezone ?? ""} /></label>
          </div>
          <label className="field"><span>One-line summary</span><input className="input" name="summary" maxLength={400} defaultValue={e.summary ?? ""} /></label>
          <div className="row2">
            <label className="field"><span>Registration URL</span><input className="input" name="registrationUrl" type="url" defaultValue={e.registrationUrl ?? ""} /></label>
            <label className="field"><span>Rules URL</span><input className="input" name="rulesUrl" type="url" defaultValue={e.rulesUrl ?? ""} /></label>
          </div>
          <div className="row2">
            <label className="field"><span>Theme</span><input className="input" name="theme" defaultValue={e.theme ?? ""} /></label>
            <label className="field"><span>Prize summary</span><input className="input" name="prizeSummary" defaultValue={e.prizeSummary ?? ""} /></label>
          </div>
          <div className="row2">
            <label className="field"><span>Team min</span><input className="input" name="teamMin" type="number" min={1} max={50} defaultValue={e.teamMin ?? ""} /></label>
            <label className="field"><span>Team max</span><input className="input" name="teamMax" type="number" min={1} max={50} defaultValue={e.teamMax ?? ""} /></label>
          </div>
          <div className="row2">
            <label className="field"><span>Solo allowed</span><select className="select input" name="solo" defaultValue={e.soloAllowed === true ? "yes" : e.soloAllowed === false ? "no" : ""}><option value="">Not stated</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="field"><span>Cost</span><select className="select input" name="cost" defaultValue={e.cost ?? ""}><option value="">Not stated</option><option value="free">Free</option><option value="paid">Paid</option></select></label>
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontWeight: 550, fontSize: 13, marginBottom: 6 }}>Categories</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{CATEGORIES.map((c) => <label key={c.id} style={{ display: "flex", gap: 4 }}><input type="checkbox" name="categories" value={c.id} defaultChecked={e.categories.includes(c.id)} />{c.label}</label>)}</div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontWeight: 550, fontSize: 13, marginBottom: 6 }}>Perks</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{PERKS.map((p) => <label key={p.id} style={{ display: "flex", gap: 4 }}><input type="checkbox" name="perks" value={p.id} defaultChecked={e.perks.includes(p.id)} />{p.label}</label>)}</div>
          </fieldset>
          <label className="field"><span>Description</span><textarea className="input" name="description" rows={4} defaultValue={e.description ?? ""} /></label>
          <label className="field"><span>Deliverables</span><textarea className="input" name="deliverables" rows={3} defaultValue={e.deliverables ?? ""} /></label>
          <label className="field"><span>Judging criteria</span><textarea className="input" name="judgingCriteria" rows={3} defaultValue={e.judgingCriteria ?? ""} /></label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary small" type="submit">Save details</button>
            <button className="btn small" type="button" onClick={() => detailsFb.run(() => patch({ hidden: !data.hidden }), data.hidden ? "Event is visible again." : "Event hidden from the public site.")}>{data.hidden ? "Unhide" : "Hide from site"}</button>
          </div>
          {detailsFb.view}
        </form>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h3>Sources and overrides</h3>
          {data.sources.map((s) => (
            <details key={`${s.source}-${s.externalId}`} style={{ marginBottom: 8 }}>
              <summary>{s.source} · {s.externalId} · last seen {formatDateTime(s.lastSeenAt, null)}</summary>
              <pre className="json">{JSON.stringify(s.record, null, 2)}</pre>
            </details>
          ))}
          {data.overrides.length > 0 && <pre className="json">{JSON.stringify(data.overrides, null, 2)}</pre>}
        </div>
      </div>
    </div>
  );
}

function Submissions({ call }: { call: Call }) {
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const load = useCallback(() => call<{ submissions: Submission[] }>("/submissions").then((r) => setSubs(r.submissions)), [call]);
  useEffect(() => void load(), [load]);
  if (!subs) return <p>Loading…</p>;
  if (!subs.length) return <p style={{ color: "var(--text-3)" }}>No submissions yet.</p>;
  return <div style={{ display: "grid", gap: 12 }}>{subs.map((s) => <SubmissionCard key={s.id} s={s} call={call} onDone={load} />)}</div>;
}

function SubmissionCard({ s, call, onDone }: { s: Submission; call: Call; onDone: () => void }) {
  const fb = useFeedback();
  const p = s.payload;
  if (s.status !== "pending") {
    return <div className="card"><strong>{p.name}</strong> <span className={`status ${s.status === "approved" ? "verified" : "ineligible"}`}>{s.status}</span>{s.review_note && <p style={{ color: "var(--text-3)" }}>{s.review_note}</p>}</div>;
  }
  return (
    <form className="card form" onSubmit={(ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget);
      const deadlineVerified = f.get("deadlineVerified") === "on";
      const event = {
        name: p.name, organizer: p.organizer, websiteUrl: p.websiteUrl, registrationUrl: p.registrationUrl, rulesUrl: f.get("rulesUrl"),
        startAt: p.startAt, endAt: p.endAt, submissionDeadlineAt: p.submissionDeadlineAt,
        submissionDeadlineVerified: deadlineVerified && Boolean(p.submissionDeadlineAt),
        submissionDeadlineSource: deadlineVerified ? f.get("deadlineSource") : null,
        format: p.format, city: f.get("city") || null, countryCode: String(f.get("countryCode") || "").toUpperCase() || null,
        description: p.description, sourceUrl: p.websiteUrl,
        eligibility: {
          status: "verified", highSchoolAllowed: true, educationLevels: ["high_school"], minAge: null, maxAge: null, grades: [],
          geographicRestrictions: null, internationalAllowed: null, requiresCollegeEnrollment: false, method: "submission",
          evidence: [{ url: f.get("rulesUrl"), quote: f.get("quote") }], sourceUrl: f.get("rulesUrl"), checkedAt: new Date().toISOString(), notes: null,
        },
      };
      fb.run(() => call(`/submissions/${s.id}/approve`, "POST", { event }).then(onDone), "Approved and published.");
    }}>
      <h3>{p.name} <small style={{ fontWeight: 400, color: "var(--text-3)" }}>submitted {formatDateTime(s.created_at, null)}</small></h3>
      <p style={{ color: "var(--text-2)" }}>{p.organizer} · {p.format} · {p.startAt && formatDateTime(p.startAt, null)} · <a href={p.websiteUrl ?? "#"} target="_blank" rel="noopener noreferrer">{p.websiteUrl}</a></p>
      {p.description && <p className="prose" style={{ color: "var(--text-2)" }}>{p.description}</p>}
      <p style={{ fontSize: 13 }}>Before approving, open the rules page and confirm the quote is really there.</p>
      <label className="field"><span>Rules URL</span><input className="input" name="rulesUrl" type="url" required defaultValue={p.rulesUrl ?? ""} /></label>
      <label className="field"><span>Quote allowing high school students</span><textarea className="input" name="quote" rows={2} required defaultValue={p.eligibilityQuote ?? ""} /></label>
      <div className="row2">
        <label className="field"><span>City</span><input className="input" name="city" defaultValue={p.city ?? ""} /></label>
        <label className="field"><span>Country code (ISO, e.g. US)</span><input className="input" name="countryCode" maxLength={2} /></label>
      </div>
      {p.submissionDeadlineAt && (
        <div className="row2">
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" name="deadlineVerified" />Deadline ({formatDateTime(p.submissionDeadlineAt, null)}) confirmed on the official site</label>
          <label className="field"><span>Deadline source URL</span><input className="input" name="deadlineSource" type="url" defaultValue={p.rulesUrl ?? ""} /></label>
        </div>
      )}
      <label style={{ display: "flex", gap: 6 }}><input type="checkbox" required />I checked the official rules myself</label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary small" type="submit">Approve and publish</button>
        <button className="btn small" type="button" onClick={() => {
          const note = window.prompt("Reason for rejecting (kept internally)") ?? null;
          fb.run(() => call(`/submissions/${s.id}/reject`, "POST", { note }).then(onDone), "Rejected.");
        }}>Reject</button>
      </div>
      {fb.view}
    </form>
  );
}

function Runs({ call }: { call: Call }) {
  const [data, setData] = useState<{ runs: Run[]; running: boolean } | null>(null);
  const load = useCallback(() => call<{ runs: Run[]; running: boolean }>("/runs").then(setData), [call]);
  useEffect(() => void load(), [load]);
  const fb = useFeedback();
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <button className="btn small" onClick={() => fb.run(() => call("/ingest", "POST").then(() => setTimeout(load, 3000)), "Ingestion started. Refresh in a minute.")}>Run ingestion now</button>
        <button className="btn small" onClick={() => void load()}>Refresh</button>
        {data?.running && <span className="status unclear">running</span>}
      </div>
      {fb.view}
      <table className="table">
        <thead><tr><th>Source</th><th>Started</th><th>Status</th><th>Stats</th></tr></thead>
        <tbody>
          {data?.runs.map((r) => (
            <tr key={r.id}>
              <td>{r.source}</td>
              <td className="num">{formatDateTime(r.started_at, null)}</td>
              <td><span className={`status ${r.status === "succeeded" ? "verified" : r.status === "failed" ? "ineligible" : "unclear"}`}>{r.status}</span>{r.error && <div style={{ color: "var(--urgent)" }}>{r.error}</div>}</td>
              <td style={{ fontSize: 12 }}>{r.stats ? Object.entries(r.stats).filter(([k]) => k !== "source").map(([k, v]) => `${k}: ${v}`).join(" · ") : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
