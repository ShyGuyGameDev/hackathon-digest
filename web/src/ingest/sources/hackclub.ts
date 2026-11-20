import type { Format } from "../../shared/types.ts";
import type { SourceModule } from "../types.ts";

// Public, unauthenticated JSON API behind https://hackathons.hackclub.com — a directory that only
// lists high school hackathons ("Listing of upcoming online and in-person high school hackathons
// around the world"). No documented rate limit; we stay polite with a 6-hour floor.
const API_URL = "https://hackathons.hackclub.com/api/events/upcoming/";
const DIRECTORY_URL = "https://hackathons.hackclub.com/";

interface HackClubEvent {
  id: string;
  name: string;
  website: string | null;
  start: string;
  end: string | null;
  createdAt: string;
  logo: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  virtual: boolean;
  hybrid: boolean;
  mlhAssociated?: boolean;
}

function isHackClubEvent(v: unknown): v is HackClubEvent {
  const e = v as HackClubEvent;
  return Boolean(e && typeof e.id === "string" && typeof e.name === "string" && typeof e.start === "string");
}

export const hackClubSource: SourceModule = {
  id: "hackclub",
  label: "Hack Club Hackathons directory",
  priority: 50,
  minIntervalHours: 6,
  async fetchRecords(ctx) {
    const res = await ctx.fetch(API_URL, {
      headers: { accept: "application/json", "user-agent": "HackathonDigestBot/0.1" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Hack Club API responded HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error("Hack Club API returned an unexpected shape");
    const events = body.filter(isHackClubEvent);
    if (events.length !== body.length) ctx.log(`[hackclub] ignored ${body.length - events.length} malformed entries`);

    return events.map((e) => {
      const format: Format = e.hybrid ? "hybrid" : e.virtual ? "online" : "in_person";
      return {
        raw: e,
        record: {
          source: "hackclub",
          externalId: e.id,
          sourceUrl: DIRECTORY_URL,
          name: e.name,
          websiteUrl: e.website,
          startAt: e.start,
          endAt: e.end,
          // The directory doesn't publish submission deadlines; they stay unverified until a reviewer confirms one.
          submissionDeadlineVerified: false,
          format,
          city: e.city,
          state: e.state,
          country: e.country,
          countryCode: e.countryCode,
          latitude: e.latitude,
          longitude: e.longitude,
          logoUrl: e.logo,
          eligibilityClaim: {
            kind: "curated_directory",
            directory: "Hack Club Hackathons",
            url: DIRECTORY_URL,
            statement: "Listed in Hack Club's directory of upcoming high school hackathons.",
          },
        },
      };
    });
  },
};
