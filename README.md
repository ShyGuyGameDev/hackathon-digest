# hackathon-digest
Hackathon digest log for automated email routine (sent weekly on Tuesdays)

## Routine spec

- **Schedule:** weekly, every Tuesday
- **Recipients:** consoleempty@gmail.com only (all digest emails, including test sends)
- **Selection:** pick one hackathon not already covered. Dedup is done by searching Gmail's sent folder for prior "Hackathon Digest: ..." subjects — NOT via `sent_log.md` (the routine's GitHub App has no repo write access, so it can't reliably commit/push a log; see note below)
- **Eligibility requirement:** the hackathon must explicitly allow high school students to participate. Skip any hackathon restricted to college/university students only (e.g. requires a college .edu email, "undergrad+" only, age 18+/enrolled-in-college-only rules). When eligibility isn't stated outright, check the official rules page before selecting.
- **Location requirement:** the hackathon must be either fully online/virtual, or in-person somewhere in the Bay Area (San Francisco Bay Area, California). Skip in-person hackathons that are far from the Bay Area (e.g. across the country or internationally) unless they are hybrid with a genuine online participation track.
- **Email detail level** — each email must include, in this order:
  - Hackathon date(s) at the very top of the body, before anything else
  - What the featured tool/platform/theme actually is (plain-language explainer, not just the name)
  - What's required to build/submit (theme, mandatory requirements, deliverables)
  - Judging/evaluation criteria
  - Format, prize pool
  - Source links
- `sent_log.md` below is a manual historical record only, not read or written by the automated routine.
- **Site update (after the email is sent, best effort):** record the emailed hackathon in the website's Supabase database. This step never blocks or changes the email: if it fails, report the error and stop. No git commit or push.
  1. Run this once, filling in the values (ISO-8601 UTC times, e.g. `2027-02-27T02:00:00Z`; `format` is `online`, `in_person` or `hybrid`; include `city`, `state`, `country`, `countryCode` only for in-person events; leave out any field you don't know):
     ```sh
     curl -sS -X POST "https://rwvykhgkhytsagbmqylr.supabase.co/rest/v1/submissions" \
       -H "apikey: sb_publishable_6zoFaKhOLGOHDcNqdZWsvA_Xfe5voKM" \
       -H "Content-Type: application/json" -H "Prefer: return=minimal" -w "HTTP %{http_code}\n" \
       -d '{"payload": {"source": "email-digest", "name": "...", "organizer": "...", "websiteUrl": "https://...", "registrationUrl": "https://...", "rulesUrl": "https://...", "startAt": "...", "endAt": "...", "format": "online"}}'
     ```
  2. `HTTP 201` means it was recorded. The website's daily job checks the event against its official site and publishes it only if high school eligibility is confirmed there. (The key above is the public, insert-only publishable key.)

### Known limitation
The Claude GitHub App for this repo is authorization-only (shows under GitHub's "Authorized GitHub Apps", not "Installed GitHub Apps") — there is no install/configure step available to grant it repo write access, so cloud routine runs cannot push commits. Dedup was moved to Gmail sent-history search to route around this entirely.

## Website (separate product, not part of the email routine)
`web/` contains a hackathon discovery website. Everything above this heading is the email routine's spec, and nothing in `web/` changes it: the routine's recipient, schedule, Gmail deduplication and online-or-Bay-Area location requirement all stay exactly as written above. The website's worldwide scope applies to the website only. See `web/README.md`.
