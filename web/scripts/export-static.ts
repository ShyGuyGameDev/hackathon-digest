// Static build for hosts without a long-running server (Vercel): ingests every source into a
// throwaway database at build time and writes the same responses the API would serve, under
// dist/api/. vercel.json rewrites /api/events, /api/events/:slug and /api/meta to these files.
// Open/closed state is still computed in the browser, so expired events drop out between builds.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../src/server/db.ts";
import { runIngestion } from "../src/ingest/pipeline.ts";
import { SOURCE_PRIORITIES, SOURCES } from "../src/ingest/sources/index.ts";
import { getEventDetail, getPublicEvents, lastIngestAt } from "../src/server/repo.ts";
import type { EventsResponse } from "../src/shared/types.ts";

const out = resolve(import.meta.dirname, "../dist/api");
const db = openDatabase(":memory:");
const now = new Date();

const report = await runIngestion(db, SOURCES, { force: true, extraPriorities: SOURCE_PRIORITIES, now, log: (m) => console.log(m) });
for (const s of report.sources) console.log(`[static] ${s.source}: ${s.error ? `FAILED ${s.error}` : `${s.fetched} records`}`);
if (report.sources.find((s) => s.source === "curated")?.error) {
  // Curated data lives in the repo; if it's invalid, fail the deploy rather than publish without it.
  throw new Error("Curated data failed to load; refusing to publish an incomplete site.");
}

mkdirSync(join(out, "events"), { recursive: true });
const events: EventsResponse = { generatedAt: now.toISOString(), mock: false, lastIngestAt: lastIngestAt(db), events: getPublicEvents(db, now) };
writeFileSync(join(out, "events.json"), JSON.stringify(events));
writeFileSync(join(out, "meta.json"), JSON.stringify({ mock: false, lastIngestAt: events.lastIngestAt, staticSite: true }));

// Details for every verified listing, including closed ones, so shared links keep resolving.
const slugs = db
  .prepare("SELECT e.slug FROM events e JOIN eligibility el ON el.event_id = e.id WHERE el.status = 'verified' AND e.hidden = 0")
  .all() as { slug: string }[];
for (const { slug } of slugs) {
  writeFileSync(join(out, "events", `${slug}.json`), JSON.stringify({ event: getEventDetail(db, slug), mock: false }));
}
console.log(`[static] wrote ${events.events.length} listings and ${slugs.length} detail pages to dist/api`);
