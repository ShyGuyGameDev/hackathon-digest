// Seeds data/mock.db with obviously fake events for UI development: `npm run seed:mock`, then
// `DATABASE_PATH=data/mock.db npm run dev`. The database is flagged as mock; the server shows a
// banner, ingestion refuses to write to it, and production mode refuses to serve it.
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase, setMeta } from "../src/server/db.ts";
import { runIngestion } from "../src/ingest/pipeline.ts";
import type { NormalizedEvent, SourceModule } from "../src/ingest/types.ts";

const path = resolve(import.meta.dirname, "../data/mock.db");
for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
const db = openDatabase(path);

const now = Date.now();
const at = (days: number, hour = 17) => {
  const d = new Date(now + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

const base = (i: number, over: Partial<NormalizedEvent>): NormalizedEvent => ({
  source: "mock",
  externalId: `mock-${i}`,
  sourceUrl: "https://example.com/",
  name: `MOCK Hackathon ${i}`,
  organizer: "Example Organizer (mock)",
  summary: "Mock listing for interface development. Not a real event.",
  websiteUrl: `https://example.com/mock-${i}`,
  registrationUrl: `https://example.com/mock-${i}/register`,
  format: "online",
  submissionDeadlineVerified: true,
  submissionDeadlineSource: `https://example.com/mock-${i}/rules`,
  eligibilityClaim: {
    kind: "attested",
    eligibility: {
      status: "verified", highSchoolAllowed: true, educationLevels: ["high_school"], minAge: 13, maxAge: 18, grades: [],
      geographicRestrictions: null, internationalAllowed: true, requiresCollegeEnrollment: false, method: "manual",
      evidence: [{ url: `https://example.com/mock-${i}/rules`, quote: "MOCK: open to high school students." }],
      sourceUrl: `https://example.com/mock-${i}/rules`, checkedAt: new Date(now).toISOString(), notes: "Mock data.",
    },
  },
  ...over,
});

const records: NormalizedEvent[] = [
  base(1, { name: "MOCK Climate Builders Jam", startAt: at(2), endAt: at(4), submissionDeadlineAt: at(4, 20), categories: ["climate", "social_impact"], perks: ["beginner_friendly", "cash_prizes"], cost: "free", teamMin: 1, teamMax: 4, soloAllowed: true, prizeSummary: "$5,000 in prizes (mock)" }),
  base(2, { name: "MOCK Robotics Weekend", format: "in_person", city: "San Jose", state: "California", country: "United States", countryCode: "US", startAt: at(9), endAt: at(10), submissionDeadlineAt: at(10, 18), categories: ["robotics", "hardware"], perks: ["hardware_prizes", "accommodation"], cost: "free", teamMin: 2, teamMax: 4 }),
  base(3, { name: "MOCK AI for Health Sprint", format: "hybrid", city: "Toronto", state: "Ontario", country: "Canada", countryCode: "CA", startAt: at(20), endAt: at(22), submissionDeadlineAt: at(22), categories: ["ai", "healthcare"], perks: ["scholarships", "internships"], cost: "free", teamMax: 5 }),
  base(4, { name: "MOCK Game Dev Month", startAt: at(-3), endAt: at(1, 23), submissionDeadlineAt: at(1, 23), categories: ["games"], perks: ["beginner_friendly"], cost: "free", soloAllowed: true, teamMax: 3 }),
  base(5, { name: "MOCK Fintech Challenge", format: "in_person", city: "London", country: "United Kingdom", countryCode: "GB", startAt: at(40), endAt: at(41), submissionDeadlineAt: at(41), categories: ["fintech", "web"], perks: ["cash_prizes", "travel_assistance"], cost: "paid", teamMin: 2, teamMax: 4 }),
  base(6, { name: "MOCK Unconfirmed Deadline Hack", format: "in_person", city: "Singapore", country: "Singapore", countryCode: "SG", startAt: at(12), endAt: at(13), submissionDeadlineAt: null, submissionDeadlineVerified: false, submissionDeadlineSource: null, categories: ["open"] }),
  base(7, { name: "MOCK Already Closed Hack", startAt: at(5), endAt: at(6), submissionDeadlineAt: at(-1), categories: ["cybersecurity"] }),
];

const mockSource: SourceModule = {
  id: "mock",
  label: "Mock data (development only)",
  priority: 1,
  minIntervalHours: 0,
  fetchRecords: async () => records.map((record) => ({ record, raw: { mock: true } })),
};

// No network: mock URLs are never fetched.
const offline = (async () => new Response("", { status: 599 })) as unknown as typeof fetch;
await runIngestion(db, [mockSource], { force: true, fetchImpl: offline });
db.exec("UPDATE events SET is_mock = 1");
setMeta(db, "mock", "1");
console.log(`Seeded ${records.length} MOCK events into ${path}`);
