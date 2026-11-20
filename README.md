# hackathon-digest
Daily routine that finds hackathons open to high school students and adds them to the website's Supabase database. It no longer sends email.

## Routine spec

- **Schedule:** daily.
- **Output:** rows in the website's Supabase `submissions` queue. Never send email, and never commit, push or edit files in this repo.
- **Scope:** hackathons anywhere in the world (online, in person or hybrid) that explicitly allow high school students. Skip events restricted to college/university students (e.g. a college .edu email, "undergrad+" only, 18+ or enrolled-in-college rules). When eligibility isn't stated outright, check the official rules before adding.
- **Supabase access (public, insert-only key; already scoped by row-level security):**
  - URL: `https://rwvykhgkhytsagbmqylr.supabase.co/rest/v1`
  - Key header: `apikey: sb_publishable_6zoFaKhOLGOHDcNqdZWsvA_Xfe5voKM`
- **Step 1 – see what's already listed:**
  ```sh
  curl -sS "https://rwvykhgkhytsagbmqylr.supabase.co/rest/v1/public_events?select=slug,name,website_url,start_at,end_at,submission_deadline_status&limit=5000" \
    -H "apikey: sb_publishable_6zoFaKhOLGOHDcNqdZWsvA_Xfe5voKM"
  ```
- **Step 2 – add new hackathons:** find up to 5 hackathons that are upcoming or open, meet the scope above, and are NOT already listed (compare names and website domains). For each, send one request:
  ```sh
  curl -sS -X POST "https://rwvykhgkhytsagbmqylr.supabase.co/rest/v1/submissions" \
    -H "apikey: sb_publishable_6zoFaKhOLGOHDcNqdZWsvA_Xfe5voKM" -H "Content-Type: application/json" -H "Prefer: return=minimal" -w "HTTP %{http_code}\n" \
    -d '{"payload": {"source": "daily-research", "name": "...", "organizer": "...", "websiteUrl": "https://...", "registrationUrl": "https://...", "rulesUrl": "https://...", "startAt": "2027-02-27T02:00:00Z", "endAt": "2027-03-01T04:00:00Z", "format": "online"}}'
  ```
  Times are ISO-8601 UTC. `format` is `online`, `in_person` or `hybrid`; add `city`, `state`, `country`, `countryCode` for in-person/hybrid events. Leave out any field you don't know; never guess.
- **Step 3 – look for newly posted deadlines:** for every listed event whose `submission_deadline_status` is `unverified`, check its official site/rules for a submission deadline. If one is posted, send:
  ```sh
  curl -sS -X POST "https://rwvykhgkhytsagbmqylr.supabase.co/rest/v1/submissions" \
    -H "apikey: sb_publishable_6zoFaKhOLGOHDcNqdZWsvA_Xfe5voKM" -H "Content-Type: application/json" -H "Prefer: return=minimal" -w "HTTP %{http_code}\n" \
    -d '{"payload": {"source": "deadline-update", "slug": "<slug from step 1>", "submissionDeadlineAt": "2027-01-13T07:59:00Z", "sourceUrl": "https://<official page that states it>", "quote": "<the exact sentence from that page that states the deadline>"}}'
  ```
  The quote must be copied word for word from the page at `sourceUrl`: the website re-fetches that page and rejects the update if the quote isn't there. If no deadline is posted, send nothing.
- **What happens next (automatic, not the routine's job):** the website's daily job (15:00 UTC) checks each new hackathon against its official site and publishes it only if high school eligibility is confirmed there, applies deadlines whose quotes it can verify, and deletes events whose deadline has passed.
- **Report:** end with the hackathons added (name, URL, HTTP status), the deadline updates sent (event, date, source, HTTP status), and any failures. If a request fails, report the status and response; don't retry with other methods.
- `sent_log.md` is a manual historical record of past emails only; don't read or write it.

### Known limitation
The Claude GitHub App for this repo is authorization-only, so cloud routine runs cannot push commits. That's why the routine writes to Supabase instead of the repo. The routine's cloud environment must allow network access to `rwvykhgkhytsagbmqylr.supabase.co`.

## Website
`web/` contains the hackathon discovery website the routine feeds (https://hackathondigest.vercel.app). See `web/README.md`.
