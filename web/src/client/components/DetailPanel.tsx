import { Fragment, useEffect, useRef, useState } from "react";
import { formatDateTime, formatRange, listingState } from "../../shared/dates.ts";
import { CATEGORIES, EDUCATION_LEVELS, PERKS, labelFor } from "../../shared/taxonomy.ts";
import type { EventDetail, EventSummary } from "../../shared/types.ts";
import { ApiError, fetchEvent } from "../lib/api.ts";
import { buildIcs, downloadFile } from "../lib/ics.ts";
import { rememberViewed } from "../lib/storage.ts";
import { DeadlinePill, FORMAT_LABEL, placeLabel } from "./EventRow.tsx";
import { AlertIcon, BackIcon, CalendarIcon, CheckIcon, ExternalIcon, LinkIcon, StarIcon, XIcon } from "./Icons.tsx";

interface Props {
  slug: string;
  preview: EventSummary | undefined;
  now: Date;
  saved: boolean;
  onToggleSave: (id: string) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

const NA = () => <span className="na">Not available</span>;

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const METHOD_TEXT: Record<string, string> = {
  curated_directory: "Listed in a directory that only lists high school hackathons, and cross-checked against the official site.",
  official_site: "The official site states that high school students can take part.",
  manual: "A reviewer checked the official rules.",
  submission: "Submitted by the organizer and checked by a reviewer against the official rules.",
};

export function DetailPanel({ slug, preview, now, saved, onToggleSave, onClose, onToast }: Props) {
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchEvent(slug)
      .then((r) => {
        if (cancelled) return;
        setDetail(r.event);
        rememberViewed(slug);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError && err.status === 404 ? "This hackathon isn't listed, or its eligibility is no longer verified." : "Couldn't load this hackathon. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const e = detail ?? preview;
  const pageUrl = `${window.location.origin}/e/${slug}`;

  async function share() {
    if (!e) return;
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) await navigator.share({ title: e.name, url: pageUrl });
      else {
        await navigator.clipboard.writeText(pageUrl);
        onToast("Link copied");
      }
    } catch {
      /* user dismissed the share sheet */
    }
  }

  function addToCalendar() {
    if (!detail) return;
    const ics = buildIcs(detail, pageUrl);
    if (ics) downloadFile(`${detail.slug}.ics`, ics, "text/calendar");
  }

  const state = e ? listingState(e, now) : null;
  const registerUrl = detail?.registrationUrl ?? detail?.websiteUrl ?? null;

  return (
    <aside className="panel" aria-label="Hackathon details">
      <div className="panel-top">
        <button type="button" className="icon-btn desktop-close" onClick={onClose} aria-label="Close details" title="Close (Esc)"><XIcon /></button>
        <button type="button" className="back-btn" onClick={onClose}><BackIcon size={18} /> Back</button>
        <span className="spacer" />
        {e && (
          <>
            <button type="button" className="icon-btn" onClick={share} aria-label="Copy link" title="Copy link"><LinkIcon /></button>
            <button type="button" className="icon-btn" onClick={addToCalendar} disabled={!detail?.startAt} aria-label="Add to calendar" title="Add to calendar (.ics)"><CalendarIcon /></button>
            <button type="button" className="icon-btn" aria-pressed={saved} onClick={() => onToggleSave(e.id)} aria-label={saved ? "Remove from saved" : "Save"} title={saved ? "Saved" : "Save"}><StarIcon filled={saved} /></button>
          </>
        )}
      </div>
      <div className="panel-body">
        {error && !e && (
          <div className="empty"><h2 ref={headingRef} tabIndex={-1}>Not found</h2><p>{error}</p></div>
        )}
        {!e && !error && (
          <div aria-busy="true" aria-label="Loading">
            <div className="skeleton" style={{ width: "70%", height: 22 }} />
            <div className="skeleton" style={{ width: "40%", marginTop: 10 }} />
            <div className="skeleton" style={{ width: "90%", marginTop: 24 }} />
            <div className="skeleton" style={{ width: "85%", marginTop: 8 }} />
          </div>
        )}
        {e && (
          <article>
            <h2 ref={headingRef} tabIndex={-1} style={{ outline: "none" }}>{e.name}</h2>
            <p className="byline">
              {[e.organizer, formatRange(e.startAt, e.endAt, e.timezone, now), [FORMAT_LABEL[e.format], placeLabel(e)].filter(Boolean).join(" · ")].filter(Boolean).join(" — ")}
            </p>
            {e.summary && <p className="lede">{e.summary}</p>}

            {state === "closed" && <p className="closed-note">This hackathon is no longer accepting submissions.</p>}
            {state === "unconfirmed" && (
              <p className="closed-note">
                <strong>Submission deadline not verified.</strong> We couldn't confirm when submissions close, so check the official site before you plan around this event.
              </p>
            )}

            <div className="cta-row">
              {registerUrl && state !== "closed" && (
                <a className="btn primary" href={registerUrl} target="_blank" rel="noopener noreferrer">
                  {detail?.registrationUrl ? "Register" : "Visit official site"} <ExternalIcon />
                </a>
              )}
              {detail?.registrationUrl && detail.websiteUrl && (
                <a className="btn" href={detail.websiteUrl} target="_blank" rel="noopener noreferrer">Official site <ExternalIcon /></a>
              )}
              {state !== "closed" && <DeadlinePill e={e} now={now} />}
            </div>

            {detail ? <Body d={detail} now={now} /> : !error && <div className="skeleton" style={{ width: "60%", marginTop: 24 }} />}
          </article>
        )}
      </div>
      {e && registerUrl && state !== "closed" && (
        // Phones: the main action stays within thumb reach while scrolling the details.
        <div className="panel-actions">
          <a className="btn primary" href={registerUrl} target="_blank" rel="noopener noreferrer">
            {detail?.registrationUrl ? "Register" : "Visit official site"} <ExternalIcon />
          </a>
          <button type="button" className="btn icon-only" aria-pressed={saved} onClick={() => onToggleSave(e.id)} aria-label={saved ? "Remove from saved" : "Save"}>
            <StarIcon filled={saved} />
          </button>
        </div>
      )}
    </aside>
  );
}

function Body({ d, now }: { d: EventDetail; now: Date }) {
  const tz = d.timezone;
  const zoneNote = tz ? `Times shown in the event's time zone (${tz}).` : "Times shown in your time zone.";
  const el = d.eligibility;
  const missing = [
    !d.theme && "theme",
    !d.description && "full description",
    !d.deliverables && "deliverables",
    !d.judgingCriteria && "judging criteria",
    !d.prizes?.length && !d.prizeSummary && "prizes",
    !d.schedule?.length && "schedule",
  ].filter(Boolean) as string[];

  return (
    <>
      <section className="section" aria-labelledby="sec-dates">
        <h3 id="sec-dates">Dates</h3>
        <dl className="facts">
          <dt>Starts</dt><dd>{d.startAt ? formatDateTime(d.startAt, tz) : <NA />}</dd>
          <dt>Ends</dt><dd>{d.endAt ? formatDateTime(d.endAt, tz) : <NA />}</dd>
          <dt>Registration closes</dt>
          <dd>
            {d.registrationDeadlineAt && d.registrationDeadlineStatus === "verified" ? formatDateTime(d.registrationDeadlineAt, tz) : <span className="na">Not verified</span>}
          </dd>
          <dt>Submissions close</dt>
          <dd>
            {d.submissionDeadlineStatus === "verified" && d.submissionDeadlineAt ? (
              <>
                {formatDateTime(d.submissionDeadlineAt, tz)}{" "}
                <span className="verified-tag"><CheckIcon size={13} />Verified</span>
                {d.submissionDeadlineSource && <div><Ext href={d.submissionDeadlineSource}>Source: {hostOf(d.submissionDeadlineSource)}</Ext></div>}
              </>
            ) : (
              <span className="unverified-tag"><AlertIcon size={13} />Not verified</span>
            )}
          </dd>
        </dl>
        <p className="hint" style={{ color: "var(--text-3)", fontSize: 12, marginTop: 8 }}>{zoneNote}</p>
      </section>

      <section className="section" aria-labelledby="sec-elig">
        <h3 id="sec-elig">Eligibility</h3>
        <p><span className="verified-tag"><CheckIcon size={13} />Open to high school students</span></p>
        <p style={{ color: "var(--text-2)", marginTop: 4 }}>{METHOD_TEXT[el.method]}</p>
        <dl className="facts" style={{ marginTop: 12 }}>
          <dt>Who can join</dt>
          <dd>{el.educationLevels.length ? el.educationLevels.map((l) => labelFor(EDUCATION_LEVELS, l)).join(", ") : <NA />}</dd>
          <dt>Age</dt>
          <dd>{el.minAge !== null || el.maxAge !== null ? [el.minAge !== null && `${el.minAge}+`, el.maxAge !== null && `up to ${el.maxAge}`].filter(Boolean).join(", ") : <span className="na">Not stated</span>}</dd>
          {el.grades.length > 0 && (<><dt>Grades</dt><dd>{el.grades.join(", ")}</dd></>)}
          <dt>Location limits</dt>
          <dd>{el.geographicRestrictions ?? (el.internationalAllowed === true ? "Open internationally" : <span className="na">Not stated</span>)}</dd>
          <dt>Last checked</dt>
          <dd>{formatDateTime(el.checkedAt, null)}</dd>
        </dl>
        {el.evidence.length > 0 && (
          <ul className="evidence">
            {el.evidence.map((ev, i) => (
              <li key={i}>
                {ev.quote ? <q>{ev.quote}</q> : ev.note}
                <div><Ext href={ev.url}>{hostOf(ev.url)}</Ext>{ev.quote && ev.note ? ` · ${ev.note}` : ""}</div>
              </li>
            ))}
          </ul>
        )}
        {el.notes && <p style={{ color: "var(--text-3)", fontSize: 12.5, marginTop: 10 }}>{el.notes}</p>}
      </section>

      <section className="section" aria-labelledby="sec-part">
        <h3 id="sec-part">Participation</h3>
        <dl className="facts">
          <dt>Format</dt><dd>{FORMAT_LABEL[d.format]}</dd>
          {d.format !== "online" && (<><dt>Location</dt><dd>{[d.venue, placeLabel(d)].filter(Boolean).join(", ") || <NA />}</dd></>)}
          <dt>Team size</dt>
          <dd>{d.teamMin !== null || d.teamMax !== null ? (d.teamMin === d.teamMax ? `${d.teamMax}` : `${d.teamMin ?? 1}–${d.teamMax ?? "any"}`) + " people" : <NA />}</dd>
          <dt>Solo allowed</dt><dd>{d.soloAllowed === null ? <NA /> : d.soloAllowed ? "Yes" : "No"}</dd>
          <dt>Cost</dt><dd>{d.cost === "free" ? "Free" : d.cost === "paid" ? "Paid entry" : <NA />}</dd>
          {d.rulesUrl && (<><dt>Rules</dt><dd><Ext href={d.rulesUrl}>Official rules</Ext></dd></>)}
        </dl>
      </section>

      {(d.theme || d.description || d.categories.length > 0 || d.technologies.length > 0) && (
        <section className="section" aria-labelledby="sec-challenge">
          <h3 id="sec-challenge">The challenge</h3>
          {d.theme && <p style={{ marginBottom: 8 }}><strong>Theme:</strong> {d.theme}</p>}
          {d.description && <p className="prose">{d.description}</p>}
          {(d.categories.length > 0 || d.technologies.length > 0) && (
            <div className="tag-list" style={{ marginTop: 10 }}>
              {d.categories.map((c) => <span className="tag" key={c}>{labelFor(CATEGORIES, c)}</span>)}
              {d.technologies.map((t) => <span className="tag" key={t}>{t}</span>)}
            </div>
          )}
        </section>
      )}

      {d.deliverables && (
        <section className="section"><h3>What to submit</h3><p className="prose">{d.deliverables}</p></section>
      )}
      {d.judgingCriteria && (
        <section className="section"><h3>Judging</h3><p className="prose">{d.judgingCriteria}</p></section>
      )}

      {(d.prizeSummary || d.prizes?.length || d.perks.length > 0) && (
        <section className="section">
          <h3>Prizes and perks</h3>
          {d.prizeSummary && <p>{d.prizeSummary}</p>}
          {d.prizes && d.prizes.length > 0 && (
            <dl className="facts" style={{ marginTop: 8 }}>
              {d.prizes.map((p, i) => (<Fragment key={i}><dt>{p.name}</dt><dd>{[p.amount, p.description].filter(Boolean).join(" — ") || <NA />}</dd></Fragment>))}
            </dl>
          )}
          {d.perks.length > 0 && <div className="tag-list" style={{ marginTop: 8 }}>{d.perks.map((p) => <span className="tag" key={p}>{labelFor(PERKS, p)}</span>)}</div>}
        </section>
      )}

      {d.schedule && d.schedule.length > 0 && (
        <section className="section">
          <h3>Schedule</h3>
          <dl className="facts">{d.schedule.map((s, i) => (<Fragment key={i}><dt>{formatDateTime(s.at, tz)}</dt><dd>{s.label}</dd></Fragment>))}</dl>
        </section>
      )}

      {missing.length > 0 && (
        <p className="closed-note" style={{ marginTop: 26 }}>
          Not yet verified: {missing.join(", ")}. {d.websiteUrl ? <>See the <Ext href={d.websiteUrl}>official site</Ext> for current details.</> : null}
        </p>
      )}

      <section className="section">
        <h3>Sources</h3>
        <div className="sources">
          {d.websiteUrl && <div>Official site: <Ext href={d.websiteUrl}>{hostOf(d.websiteUrl)}</Ext></div>}
          {d.registrationUrl && <div>Registration: <Ext href={d.registrationUrl}>{hostOf(d.registrationUrl)}</Ext></div>}
          {d.sources.map((s) => (
            <div key={s.source}>
              {s.label}{s.url && <> · <Ext href={s.url}>{hostOf(s.url)}</Ext></>} · seen {formatRange(s.fetchedAt, null, null, now)}
            </div>
          ))}
          {d.lastVerifiedAt && <div>Last verified {formatDateTime(d.lastVerifiedAt, null)}</div>}
        </div>
      </section>
    </>
  );
}
