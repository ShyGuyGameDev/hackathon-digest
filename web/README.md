# Hackathon Digest: website

A discovery site for hackathons worldwide that are **verified** to accept high school students.

This is a separate product from the weekly email digest described in the root `README.md`. Neither depends on the other: the
email routine doesn't read this database, and this site doesn't use the email's rules. In particular, the email's
online-or-Bay-Area restriction does **not** apply here.

## Quick start

Requires Node 22.18 or newer. Node 24 or 26 is recommended: the built-in `node:sqlite` and TypeScript type stripping mean no
database server or build step is needed for the backend.

```sh
cd web
npm install
cp .env.example .env        # then set ADMIN_TOKEN (openssl rand -hex 32)
npm run ingest              # pull real events from the sources into data/hackathons.db
npm run dev                 # API on :8787, site on http://localhost:5173
```

Production:

```sh
npm run build && npm start  # serves the API and the built site on $PORT
```

To work on the interface with fake data, run `npm run seed:mock` and then `DATABASE_PATH=data/mock.db npm run dev`. That
database is flagged as mock in several ways:

- Every page shows a "Mock data" badge.
- Ingestion refuses to write to it.
- `npm start` (production) refuses to serve it.
- A real database never serves mock rows.

Other scripts: `npm test` (30 tests covering dates, filters, eligibility, ingestion, submissions and admin), `npm run typecheck`.

## How it works

```
sources ──► validate ──► dedupe/upsert ──► merge (+ reviewer overrides) ──► verify eligibility ──► SQLite
(src/ingest/sources)   normalize.ts   store.ts        merge.ts                  eligibility.ts       │
                                                                                                    ▼
                    browser ◄── /api/events (verified, not hidden, not closed) ◄── src/server
```

- **Sources** (`src/ingest/sources/`): each module maps one source to `NormalizedEvent`. Current sources:
  - `hackclub`: Hack Club's public high-school directory API.
  - `curated`: reviewer-researched JSON in `data/curated/`; see the README there.
  - Approved organizer submissions.

  Devpost, MLH and Devfolio are intentionally absent; see `docs/RESEARCH.md`. To add a source, write a module and register
  it in `sources/index.ts`.
- **Validation** drops bad fields rather than guessing. A record is rejected if it has no name or no usable dates. A deadline
  can only be "verified" if it comes with the URL of the page that states it.
- **Deduplication** matches records to an event by:
  1. the same source ID;
  2. the same identifying website host with start dates within 3 days;
  3. the same normalized name (case, punctuation and years ignored) with start dates within 7 days.

  Every source record is kept in `event_sources`, so updates never create duplicates and slugs stay stable.
- **Merging** works field by field, with the highest-priority source winning: curated (100), then submission (80), then
  Hack Club (50). A verified deadline beats an unverified one. Reviewer overrides (`event_overrides`) are applied last and
  survive re-ingestion.
- **Eligibility** is stored separately (`eligibility` table) with status, education levels, age limits, grades, geographic
  limits, evidence quotes and URLs, method, check time, and a hash of the official page's text. Only `verified` events are
  public. The rules are in `src/ingest/eligibility.ts`, and the About page explains them to visitors:
  - Anything that excludes high schoolers makes the event `ineligible`, or `unclear` if the signals conflict.
  - If the official site is unreachable, the event is `unclear`.
  - A high-school-only directory listing plus a non-contradicting official site makes it `verified`. So does explicit
    wording on the official site.
  - A manual decision stands until the official page changes, at which point it's flagged for review.
- **Deadlines and expiry** are computed at request time from dates, with no stored "active" flags
  (`src/shared/dates.ts`):
  - With a verified deadline, the event is open until that deadline passes.
  - Without a verified deadline, it's "unconfirmed" until the event ends, and excluded from the default results.
  - Events with no dates are never shown.
- **The site** (`src/client/`) is React with no router or UI library. It loads all open events once, then filters and sorts
  in the browser using the same shared code as the server (`src/shared/filters.ts`), so results update instantly. Filters
  live in the URL, results are rendered 50 at a time, and the detail panel has its own URL (`/e/<slug>`). Saved events and
  recently viewed events stay in the browser, so there are no accounts.

## Scheduling

Set `INGEST_ON_SCHEDULE=1` and the server ingests every `INGEST_INTERVAL_HOURS` (default 6). Each source also has its own
minimum interval, and official pages are cached for 20 hours, so a run costs about one API call plus one fetch per new or
stale event. Alternatively, run `npm run ingest` from cron or any scheduler on the same machine as the database.

## Reviewing (admin)

Open `/admin` and enter `ADMIN_TOKEN`. The **Needs review** tab lists open events whose eligibility is unclear, whose
official page changed after a manual check, or whose submission deadline isn't verified. For each event you can:

- **Confirm the submission deadline.** This requires the URL of the official page that states it.
- **Record an eligibility decision.** "Verified" requires an exact quote from the official rules.
- **Fill in verified details** (organizer, categories, perks, team size, prizes, judging, time zone), or hide the event.

Approving an organizer submission also requires confirming the rules quote yourself.

## Why SQLite and not Supabase

The data is small (hundreds to low thousands of events), there is one writer (ingestion and admin), and no user accounts
are needed. A single SQLite file covers all of that with zero external services and no credentials to manage. The schema
(`migrations/`) is plain SQL with JSON stored as TEXT, so moving to Postgres or Supabase later means porting the migration
(TEXT JSON → `jsonb`) and swapping `src/server/db.ts`; the rest of the code doesn't change. Consider that move only if you
need several app instances, user accounts, or managed backups.

## Deploying

Any Node host with a persistent disk works, for example a Fly.io volume, a Render or Railway disk, or a small VPS:

1. `npm ci && npm run build`
2. Set the environment variables:
   - `DATABASE_PATH`: on the persistent disk
   - `ADMIN_TOKEN`: a long random string
   - `PORT`
   - `INGEST_ON_SCHEDULE=1`
   - `PUBLIC_ORIGIN=https://your-domain`
3. `npm start`

Back up the `.db` file regularly. All secrets stay server-side; the browser bundle contains none.

## Known limits

- **Coverage** is limited to sources whose terms allow automated use (today, Hack Club's directory) plus curated entries
  and submissions.
- **Hack Club provides no submission deadlines.** Until a reviewer confirms them, those events appear only when a visitor
  includes unconfirmed deadlines; the empty state offers this with one click.
- **Hack Club provides no time zone**, so its events are shown in the visitor's own time zone and labelled as such.
- **Filters for categories, perks, team size and age** only appear once some listed events have that information
  verified. This is intentional: it avoids filters that silently match nothing.
