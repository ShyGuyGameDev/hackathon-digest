import { useState } from "react";
import { submitEvent } from "../lib/api.ts";
import { onLinkClick, useDocumentTitle } from "../lib/router.ts";

const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function SubmitPage() {
  useDocumentTitle("Suggest a hackathon · Hackathon Digest");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setStatus("sending");
    setError(null);
    try {
      await submitEvent({
        ...data,
        startAt: toIso(data.startAt ?? ""),
        endAt: toIso(data.endAt ?? ""),
        submissionDeadlineAt: toIso(data.submissionDeadlineAt ?? ""),
      });
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <main id="main" className="narrow">
        <h1>Thanks — we'll review it</h1>
        <p className="sub">
          A reviewer will check the official rules and dates before anything is published. Events that can't be verified as open
          to high school students aren't listed.
        </p>
        <a className="btn" href="/" onClick={(e) => onLinkClick(e, "/")}>Back to hackathons</a>
      </main>
    );
  }

  return (
    <main id="main" className="narrow">
      <h1>Suggest a hackathon</h1>
      <p className="sub">
        Organizers and students can suggest events. Nothing appears on the site until a reviewer has checked the official rules,
        dates and eligibility. Linking the rules page that allows high school students speeds this up.
      </p>
      <form className="form" onSubmit={onSubmit} noValidate={false}>
        <label className="field"><span>Event name</span><input className="input" name="name" required maxLength={200} /></label>
        <label className="field"><span>Organizer</span><input className="input" name="organizer" maxLength={200} /></label>
        <div className="row2">
          <label className="field"><span>Official website</span><input className="input" name="websiteUrl" type="url" required placeholder="https://" /></label>
          <label className="field"><span>Registration page</span><input className="input" name="registrationUrl" type="url" placeholder="https://" /></label>
        </div>
        <label className="field">
          <span>Rules or eligibility page</span>
          <input className="input" name="rulesUrl" type="url" required placeholder="https://" />
          <small>The official page that says who can participate.</small>
        </label>
        <label className="field">
          <span>What the rules say about high school students</span>
          <textarea className="input" name="eligibilityQuote" rows={3} required maxLength={1000} placeholder="e.g. “Open to all students aged 13–18 currently enrolled in high school.”" />
          <small>Paste the exact wording.</small>
        </label>
        <div className="row2">
          <label className="field"><span>Starts</span><input className="input" name="startAt" type="datetime-local" required /></label>
          <label className="field"><span>Ends</span><input className="input" name="endAt" type="datetime-local" /></label>
        </div>
        <label className="field">
          <span>Submission deadline</span>
          <input className="input" name="submissionDeadlineAt" type="datetime-local" />
          <small>Times are in your current time zone.</small>
        </label>
        <div className="row2">
          <label className="field">
            <span>Format</span>
            <select className="select input" name="format" required defaultValue="">
              <option value="" disabled>Choose…</option>
              <option value="online">Online</option>
              <option value="in_person">In person</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </label>
          <label className="field"><span>City and country (if in person)</span><input className="input" name="city" maxLength={120} /></label>
        </div>
        <label className="field"><span>Short description</span><textarea className="input" name="description" rows={4} maxLength={4000} /></label>
        <label className="field">
          <span>Your email (optional)</span>
          <input className="input" name="contactEmail" type="email" maxLength={200} />
          <small>Only used if a reviewer has a question. Never shown publicly.</small>
        </label>
        <input type="text" name="website_confirm" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-9999px" }} />
        {error && <p className="alert error" role="alert">{error}</p>}
        <div><button className="btn primary" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Submit for review"}</button></div>
      </form>
    </main>
  );
}
