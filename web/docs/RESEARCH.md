# Research notes

Short record of what was checked before building, and how it shaped decisions. Checked November 2026.

## Data sources

| Source | Access | Decision |
|---|---|---|
| **Hack Club Hackathons** (hackathons.hackclub.com) | Public JSON at `/api/events/upcoming/`, no auth, no robots.txt, no published rate limit. The site describes itself as a "Listing of upcoming online and in-person high school hackathons around the world". Returned 17 upcoming events on 2026-11-19. Fields: id, name, website, start, end, city/state/country/countryCode, lat/long, virtual, hybrid, logo, banner. No submission deadlines, descriptions, eligibility rules, team sizes or prizes. | **Used** (`src/ingest/sources/hackclub.ts`), polled at most every 6 hours. |
| **Devpost** | No documented public API. Third-party scrapers call an undocumented `devpost.com/api/hackathons` endpoint. Devpost's Terms of Service prohibit using "automated software, devices, scripts robots, or other means or processes to access, 'scrape,' 'crawl' or 'spider' the Site". | **Not used.** Devpost-hosted events can still be added via the curated file or organizer submissions. |
| **Major League Hacking** (mlh.io) | No official or documented public event API; only unofficial and abandoned scrapers. Most MLH events are college-focused. | **Not used.** Contact league@mlh.io about data access if needed later. |
| **Devfolio** | Terms of Use don't describe an API. No documented public event feed. | **Not used.** |
| **Official event sites** | Fetched only to verify an event we already know about, never crawled for discovery. robots.txt is honoured, requests identify themselves (`HackathonDigestBot`), there's a 12s timeout and 1.5MB cap, results are cached for 20h, and at most 2 linked rules/FAQ pages are read per event. | **Used for verification.** |

Consequences:

- **Coverage today is mostly Hack Club's directory.** Expanding coverage needs either curated entries (`data/curated/`), organizer submissions, or a new source module for a feed whose terms allow it.
- **Submission deadlines aren't in any automated source**, so they start out "unverified". Per the product rules, unverified deadlines are excluded from the default results until a reviewer confirms them in `/admin`.
- Many event sites render client-side, so the official page's text is often just its meta description. Eligibility verification for directory events therefore relies on "listed by a high-school-only directory AND the official site is reachable AND contains nothing that excludes high schoolers"; explicit wording is recorded as extra evidence when found.

## Existing hackathon directories

- **Devpost:** big card grid with strong filters (status, location, themes, prize, host). Deadlines are shown as "x days left" countdowns. It mixes high school and college events, and eligibility is buried in each event's rules.
- **MLH:** a season page of large logo cards with dates and city, no search and few filters. It's college-oriented.
- **Hack Club Hackathons:** high school only, and a clean list with a map. It filters only by region, has no deadlines or eligibility detail, and offers little search.
- **Devfolio:** India-centric. Cards include "applications close" dates, but the pages are heavily branded.

Gaps this product targets: eligibility as a guarantee rather than a filter, with the evidence shown; deadline accuracy (no expired listings, no invented countdowns); and dense, comparable listings with faceted filters and shareable URLs.

## Interface principles

These were drawn from long-standing patterns in Linear, Vercel, Raycast, Stripe, Notion, Airbnb, Arc and Apple. They were applied from prior familiarity with those products, not from visual browsing during this build.

- **Content first.** Linear and Vercel dashboards open on the data, with no hero section. Here, a one-line heading, then search, then results, all above the fold.
- **Tables over cards for comparison.** Linear's issue list and Stripe's tables fit 10–15 items per screen. Here, rows of about 64px in aligned columns (date, name, format/location, deadline), so events can be scanned vertically.
- **Detail without losing your place.** Linear, Mail and Notion peek views open details in a side panel that keeps the list visible and has its own URL. Here, a side panel on desktop and a full-screen sheet on mobile, both at `/e/<slug>`.
- **Faceted filtering.** Airbnb and e-commerce search show counts per option, removable chips, "Clear all", URL state, and a bottom sheet with a "Show N results" button on mobile.
- **Restraint.** One neutral ramp, one accent colour (ink green) for the brand and focus, and one vermilion used only for urgency. Hairline borders, no gradients or glass effects, system fonts with tabular numerals (as in Apple and Stripe), and motion limited to 150–200ms panel entrances that respect `prefers-reduced-motion`.
- **Keyboard first.** As in Raycast, `/` focuses search, Esc closes panels, focus rings are always visible, and every interactive element is native or labelled.
