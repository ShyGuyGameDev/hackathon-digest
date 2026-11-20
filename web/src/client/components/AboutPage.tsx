import { onLinkClick, useDocumentTitle } from "../lib/router.ts";

export function AboutPage() {
  useDocumentTitle("How listings are verified · Hackathon Digest");
  return (
    <main id="main" className="narrow">
      <h1>How listings are verified</h1>
      <p className="sub">
        Every hackathon here has been checked to accept high school students. If we can't verify that, it isn't listed.
      </p>

      <h2>Eligibility</h2>
      <p>An event is listed only when one of these is true:</p>
      <ul>
        <li>It comes from a directory that only lists high school hackathons, and its official site doesn't contradict that.</li>
        <li>Its official site or rules explicitly say high school students can participate.</li>
        <li>A reviewer read the official rules and recorded the exact wording.</li>
      </ul>
      <p>
        Events limited to college or university students, events that need a .edu email, and events with age limits that exclude
        high schoolers are excluded. When the official wording is ambiguous, the event is held back for manual review rather than
        guessed at. Each event page shows the evidence used and when it was last checked.
      </p>

      <h2>Deadlines</h2>
      <p>
        Whether an event is still open is calculated from its submission deadline, not its start date, and recalculated every time
        you load the page. A submission deadline counts as verified only when it comes from an official page. Events without one are
        labelled “Deadline unconfirmed” and left out of the default results; you can choose to include them.
      </p>

      <h2>Sources</h2>
      <ul>
        <li>
          <a href="https://hackathons.hackclub.com/" target="_blank" rel="noopener noreferrer">Hack Club Hackathons</a>, a public directory
          of high school hackathons, checked several times a day.
        </li>
        <li>Events researched by reviewers from official sites.</li>
        <li>Organizer submissions, published only after review. <a href="/submit" onClick={(e) => onLinkClick(e, "/submit")}>Suggest an event</a>.</li>
      </ul>
      <p>
        When the same event appears in several places it's merged into one listing, and official information takes precedence.
        Official sites are fetched politely: robots.txt is respected and pages are cached.
      </p>

      <h2>Your data</h2>
      <p>There are no accounts. Saved events and recently viewed events stay in your browser.</p>
    </main>
  );
}
