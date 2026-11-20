// migrations/001_init.sql
var init_default = "-- Core schema. Written in portable SQL (SQLite dialect, no SQLite-only features beyond JSON-as-TEXT)\n-- so it can be ported to PostgreSQL by swapping TEXT JSON columns for jsonb.\n\n-- Canonical, merged hackathon records. One row per real-world event, however many sources list it.\nCREATE TABLE events (\n  id                            TEXT PRIMARY KEY,\n  slug                          TEXT NOT NULL UNIQUE,\n  name                          TEXT NOT NULL,\n  organizer                     TEXT,\n  summary                       TEXT,\n  description                   TEXT,\n  website_url                   TEXT,\n  registration_url              TEXT,\n  rules_url                     TEXT,\n  start_at                      TEXT,             -- ISO-8601 UTC\n  end_at                        TEXT,\n  timezone                      TEXT,             -- IANA zone when known\n  registration_deadline_at      TEXT,\n  registration_deadline_status  TEXT NOT NULL DEFAULT 'unverified' CHECK (registration_deadline_status IN ('verified','unverified')),\n  submission_deadline_at        TEXT,\n  submission_deadline_status    TEXT NOT NULL DEFAULT 'unverified' CHECK (submission_deadline_status IN ('verified','unverified')),\n  submission_deadline_source    TEXT,             -- where the verified deadline came from\n  format                        TEXT NOT NULL CHECK (format IN ('online','in_person','hybrid')),\n  venue                         TEXT,\n  city                          TEXT,\n  state                         TEXT,\n  country                       TEXT,\n  country_code                  TEXT,\n  region                        TEXT,\n  latitude                      REAL,\n  longitude                     REAL,\n  team_min                      INTEGER,\n  team_max                      INTEGER,\n  solo_allowed                  INTEGER,          -- NULL = not stated\n  categories                    TEXT NOT NULL DEFAULT '[]',\n  technologies                  TEXT NOT NULL DEFAULT '[]',\n  perks                         TEXT NOT NULL DEFAULT '[]',\n  cost                          TEXT CHECK (cost IN ('free','paid')),\n  theme                         TEXT,\n  deliverables                  TEXT,\n  judging_criteria              TEXT,\n  prize_summary                 TEXT,\n  prizes                        TEXT,             -- JSON array or NULL\n  schedule                      TEXT,             -- JSON array or NULL\n  logo_url                      TEXT,\n  dedupe_key                    TEXT NOT NULL,\n  website_host                  TEXT,\n  hidden                        INTEGER NOT NULL DEFAULT 0,\n  is_mock                       INTEGER NOT NULL DEFAULT 0,\n  first_seen_at                 TEXT NOT NULL,\n  last_verified_at              TEXT,\n  created_at                    TEXT NOT NULL,\n  updated_at                    TEXT NOT NULL\n);\nCREATE INDEX events_dedupe_key ON events (dedupe_key);\nCREATE INDEX events_website_host ON events (website_host);\nCREATE INDEX events_start_at ON events (start_at);\n\n-- Eligibility is kept apart from event facts: it has its own evidence, method and review cycle.\nCREATE TABLE eligibility (\n  event_id                      TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,\n  status                        TEXT NOT NULL CHECK (status IN ('verified','unclear','ineligible')),\n  high_school_allowed           INTEGER,\n  education_levels              TEXT NOT NULL DEFAULT '[]',\n  min_age                       INTEGER,\n  max_age                       INTEGER,\n  grades                        TEXT NOT NULL DEFAULT '[]',\n  geographic_restrictions       TEXT,\n  international_allowed         INTEGER,\n  requires_college_enrollment   INTEGER,\n  method                        TEXT NOT NULL,\n  evidence                      TEXT NOT NULL DEFAULT '[]',\n  source_url                    TEXT,\n  content_hash                  TEXT,             -- hash of the official page text at check time\n  checked_at                    TEXT NOT NULL,\n  notes                         TEXT,\n  manual                        INTEGER NOT NULL DEFAULT 0,\n  needs_review                  INTEGER NOT NULL DEFAULT 0\n);\nCREATE INDEX eligibility_status ON eligibility (status);\n\n-- Every place an event was found. (source, external_id) is the stable identity used for updates.\nCREATE TABLE event_sources (\n  id                            INTEGER PRIMARY KEY AUTOINCREMENT,\n  event_id                      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,\n  source                        TEXT NOT NULL,\n  external_id                   TEXT NOT NULL,\n  source_url                    TEXT,\n  normalized                    TEXT NOT NULL,    -- the source's normalized record (JSON)\n  raw                           TEXT,             -- original payload (JSON) for audits\n  first_seen_at                 TEXT NOT NULL,\n  last_seen_at                  TEXT NOT NULL,\n  UNIQUE (source, external_id)\n);\nCREATE INDEX event_sources_event ON event_sources (event_id);\n\n-- Reviewer edits. Applied on top of merged source data, so re-ingestion never overwrites them.\nCREATE TABLE event_overrides (\n  event_id                      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,\n  field                         TEXT NOT NULL,\n  value                         TEXT NOT NULL,    -- JSON\n  note                          TEXT,\n  updated_at                    TEXT NOT NULL,\n  PRIMARY KEY (event_id, field)\n);\n\n-- Cached fetches of official pages (eligibility checks, link checks).\nCREATE TABLE page_checks (\n  url                           TEXT PRIMARY KEY,\n  status_code                   INTEGER,\n  ok                            INTEGER NOT NULL,\n  final_url                     TEXT,\n  content_hash                  TEXT,\n  text_excerpt                  TEXT,             -- normalized visible text, capped\n  robots_allowed                INTEGER NOT NULL DEFAULT 1,\n  error                         TEXT,\n  checked_at                    TEXT NOT NULL\n);\n\nCREATE TABLE ingestion_runs (\n  id                            INTEGER PRIMARY KEY AUTOINCREMENT,\n  source                        TEXT NOT NULL,\n  started_at                    TEXT NOT NULL,\n  finished_at                   TEXT,\n  status                        TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),\n  stats                         TEXT,\n  error                         TEXT\n);\n\n-- Organizer suggestions. Never public until a reviewer approves them.\nCREATE TABLE submissions (\n  id                            INTEGER PRIMARY KEY AUTOINCREMENT,\n  created_at                    TEXT NOT NULL,\n  status                        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),\n  payload                       TEXT NOT NULL,\n  contact_email                 TEXT,\n  review_note                   TEXT,\n  reviewed_at                   TEXT,\n  event_id                      TEXT REFERENCES events(id) ON DELETE SET NULL\n);\n\nCREATE TABLE meta (\n  key                           TEXT PRIMARY KEY,\n  value                         TEXT NOT NULL\n);\n";

// src/functions/sync.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";

// src/server/db.ts
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
var MIGRATIONS_DIR = join(ROOT, "migrations");
function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// src/shared/dates.ts
var HOUR = 36e5;
var DAY = 24 * HOUR;
function listingState(e, now) {
  if (e.submissionDeadlineStatus === "verified" && e.submissionDeadlineAt) {
    return Date.parse(e.submissionDeadlineAt) > now.getTime() ? "open" : "closed";
  }
  const ref = e.endAt ?? e.startAt;
  if (!ref) return "closed";
  return Date.parse(ref) > now.getTime() ? "unconfirmed" : "closed";
}
function isValidInstant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

// src/ingest/eligibility.ts
var NEGATIVE = [
  ["High school students excluded", /\bhigh[\s-]?school(?:ers| students?)? (?:are|is) not (?:eligible|allowed|permitted)\b/i],
  ["University students only", /\b(?:only|exclusively) (?:open )?(?:to |for )?(?:current(?:ly enrolled)? )?(?:university|college|undergraduate|graduate|post-?secondary) students\b/i],
  ["University students only", /\b(?:university|college|undergraduate|graduate) students only\b/i],
  ["Requires university enrollment", /\bmust be (?:a )?(?:currently )?(?:enrolled|registered) (?:as a student )?(?:at|in) (?:an? )?(?:accredited )?(?:university|college|post-?secondary)\b/i],
  ["Requires a .edu email", /\b(?:valid|your|a) \.edu (?:email|e-mail|address)\b|\b\.edu (?:email|e-mail) (?:is )?required\b/i],
  ["Must be 18 or older", /\b(?:must|need to) be (?:at least )?18(?: years(?: old| of age)?)?(?: or older)?\b(?! to (?:receive|claim|win))(?! or (?:younger|under))/i],
  ["Must be 18 or older", /\bparticipants? must be (?:aged )?18\+/i],
  ["Adults only", /\b(?:adults only|open only to (?:those|people|individuals) (?:aged )?18)\b/i]
];
var POSITIVE = [
  ["Mentions high school participants", /\b(?:for|open to|welcom(?:e|es|ing)|calling all|all) (?:current )?(?:middle (?:and|&) )?high[\s-]?school(?:ers| students?)\b/i],
  ["Mentions high school participants", /\bhigh[\s-]?school(?:ers| students?) (?:are |is )?(?:welcome|eligible|invited|allowed)\b/i],
  ["High school hackathon", /\b(?:a |the |largest |biggest |first )?high[\s-]?school hackathon\b/i],
  ["Mentions high school participants", /\bhigh[\s-]?schoolers\b/i],
  ["Open to secondary school students", /\bsecondary[\s-]school students?\b/i],
  ["Grade range includes high school", /\bgrades? (?:[6-9]|1[0-2])\s*(?:-|–|to|through)\s*(?:1[0-2])\b/i],
  ["Age range includes high school ages", /\bages? (?:1[0-7])\s*(?:-|–|to)\s*(?:1[7-9])\b/i],
  ["Open to everyone", /\bopen to (?:all ages|everyone|anyone|all students)\b/i],
  ["Open to everyone", /\bno age (?:limit|restriction|requirement)s?\b/i],
  ["Pre-college participants", /\bpre-?college students?\b/i],
  ["Open to teens", /\b(?:for|open to|welcom(?:e|es|ing)|calling all) teens\b|\bteen-only\b|\bteens aged\b/i]
];
function quoteAround(text, index, length) {
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1, index - 140);
  let end = text.indexOf("\n", index + length);
  if (end === -1 || end > index + length + 140) end = Math.min(text.length, index + length + 140);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
function analyzeText(pages) {
  const positive = [];
  const negative = [];
  let minAge = null;
  let maxAge = null;
  const levels = /* @__PURE__ */ new Set();
  for (const { url, text } of pages) {
    for (const [label, re] of NEGATIVE) {
      const m = re.exec(text);
      if (m) negative.push({ label, url, quote: quoteAround(text, m.index, m[0].length) });
    }
    for (const [label, re] of POSITIVE) {
      const m = re.exec(text);
      if (m && !positive.some((p) => p.label === label)) {
        positive.push({ label, url, quote: quoteAround(text, m.index, m[0].length) });
        if (/high|secondary|grade|teen/i.test(label)) levels.add("high_school");
        if (label === "Open to everyone") levels.add("anyone");
      }
    }
    const age = /\bages? (\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\b/i.exec(text);
    if (age && minAge === null) {
      const lo = Number(age[1]);
      const hi = Number(age[2]);
      if (lo >= 10 && lo <= 18 && hi >= lo && hi <= 25) {
        minAge = lo;
        maxAge = hi;
      }
    }
  }
  return { positive, negative, minAge, maxAge, levels: [...levels] };
}
var toEvidence = (f) => ({ url: f.url, quote: f.quote, note: f.label });
function decideEligibility(claim, page, existing, now) {
  const checkedAt = now.toISOString();
  const hash = page?.contentHash ?? null;
  if (existing?.manual) {
    const changed = Boolean(hash && existing.contentHash && hash !== existing.contentHash);
    return {
      eligibility: { ...existing.eligibility, needsReview: existing.eligibility.needsReview || changed },
      manual: true,
      contentHash: existing.contentHash ?? hash
    };
  }
  if (claim?.kind === "attested") {
    return { eligibility: { ...claim.eligibility, needsReview: false }, manual: true, contentHash: hash };
  }
  const analysis = page?.ok ? analyzeText(page.pages) : null;
  const base = {
    status: "unclear",
    highSchoolAllowed: null,
    educationLevels: analysis?.levels ?? [],
    minAge: analysis?.minAge ?? null,
    maxAge: analysis?.maxAge ?? null,
    grades: [],
    geographicRestrictions: null,
    internationalAllowed: null,
    requiresCollegeEnrollment: null,
    method: claim?.kind === "curated_directory" ? "curated_directory" : "official_site",
    evidence: [],
    sourceUrl: page?.url ?? null,
    checkedAt,
    notes: null,
    needsReview: false
  };
  const directoryEvidence = claim?.kind === "curated_directory" ? [{ url: claim.url, quote: claim.statement, note: claim.directory }] : [];
  if (analysis && analysis.negative.length) {
    const conflicting = analysis.positive.length > 0 || directoryEvidence.length > 0;
    return {
      eligibility: {
        ...base,
        status: conflicting ? "unclear" : "ineligible",
        highSchoolAllowed: conflicting ? null : false,
        requiresCollegeEnrollment: analysis.negative.some((n) => /university|\.edu/i.test(n.label)) || null,
        evidence: [...directoryEvidence, ...analysis.negative.map(toEvidence), ...analysis.positive.map(toEvidence)],
        notes: conflicting ? "The official site contains wording that may exclude high school students. Needs manual review." : "The official site excludes high school students.",
        needsReview: conflicting
      },
      manual: false,
      contentHash: hash
    };
  }
  if (!page || !page.ok) {
    return {
      eligibility: {
        ...base,
        evidence: directoryEvidence,
        notes: `Official site could not be checked${page?.error ? ` (${page.error})` : ""}.`
      },
      manual: false,
      contentHash: hash
    };
  }
  const positives = analysis.positive.map(toEvidence);
  if (directoryEvidence.length || positives.length) {
    const levels = new Set(base.educationLevels);
    levels.add("high_school");
    return {
      eligibility: {
        ...base,
        status: "verified",
        highSchoolAllowed: true,
        educationLevels: [...levels],
        method: directoryEvidence.length ? "curated_directory" : "official_site",
        evidence: [...directoryEvidence, ...positives, ...positives.length ? [] : [{ url: page.url, note: "Official site checked; no restrictions excluding high school students found." }]],
        notes: positives.length ? null : "The official site does not state eligibility in text we could read; listing relies on the high-school-only directory."
      },
      manual: false,
      contentHash: hash
    };
  }
  return {
    eligibility: { ...base, notes: "No explicit statement that high school students may participate was found." },
    manual: false,
    contentHash: hash
  };
}

// src/ingest/fetchPage.ts
import { createHash } from "node:crypto";
var USER_AGENT = `HackathonDigestBot/0.1 (+${process.env.PUBLIC_ORIGIN ?? "http://localhost:8787"}/about)`;
var TIMEOUT_MS = 12e3;
var MAX_BYTES = 15e5;
var robotsCache = /* @__PURE__ */ new Map();
async function disallowRules(origin, fetchImpl) {
  let p = robotsCache.get(origin);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetchImpl(`${origin}/robots.txt`, {
          headers: { "user-agent": USER_AGENT },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!res.ok) return [];
        const body = await res.text();
        if (/<html/i.test(body.slice(0, 200))) return [];
        return parseRobots(body);
      } catch {
        return [];
      }
    })();
    robotsCache.set(origin, p);
  }
  return p;
}
function parseRobots(body, agent = "hackathondigestbot") {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*(?:#.*)?$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2];
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push(current = { agents: [], disallow: [] });
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (key === "disallow" && current && value) current.disallow.push(value);
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.disallow);
}
function robotsAllows(rules, path) {
  return !rules.some((rule) => {
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern.endsWith("\\$") ? pattern.slice(0, -2) + "$" : pattern}`).test(path);
  });
}
var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}
function extractText(html) {
  return decodeEntities(
    html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
  ).replace(/[ \t\f\v ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}
function metaContent(html, name) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
  return content ? decodeEntities(content).trim() || null : null;
}
function extractLinks(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      out.push({ href: new URL(m[1], base).toString(), text: extractText(m[2]).slice(0, 80) });
    } catch {
    }
  }
  return out;
}
function hashText(text) {
  return createHash("sha256").update(text.replace(/\d+/g, "#")).digest("hex").slice(0, 32);
}
async function fetchPage(url, fetchImpl = fetch) {
  const empty = {
    url,
    finalUrl: null,
    ok: false,
    statusCode: null,
    robotsAllowed: true,
    text: "",
    metaDescription: null,
    links: [],
    contentHash: null,
    error: null
  };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ...empty, error: "invalid URL" };
  }
  const rules = await disallowRules(parsed.origin, fetchImpl);
  if (!robotsAllows(rules, parsed.pathname || "/")) return { ...empty, robotsAllowed: false, error: "disallowed by robots.txt" };
  try {
    const res = await fetchImpl(url, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok) return { ...empty, finalUrl: res.url || null, statusCode: res.status, error: `HTTP ${res.status}` };
    if (!/html|text/i.test(type)) return { ...empty, finalUrl: res.url || null, statusCode: res.status, ok: true, error: `non-HTML content (${type})` };
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BYTES);
    const html = buf.toString("utf8");
    const text = extractText(html);
    return {
      url,
      finalUrl: res.url || url,
      ok: true,
      statusCode: res.status,
      robotsAllowed: true,
      text,
      metaDescription: metaContent(html, "description") ?? metaContent(html, "og:description"),
      links: extractLinks(html, res.url || url),
      contentHash: hashText(text),
      error: null
    };
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }
}

// src/shared/taxonomy.ts
var CATEGORIES = [
  { id: "ai", label: "Artificial intelligence" },
  { id: "ml", label: "Machine learning" },
  { id: "robotics", label: "Robotics" },
  { id: "hardware", label: "Hardware" },
  { id: "web", label: "Web development" },
  { id: "mobile", label: "Mobile apps" },
  { id: "games", label: "Game development" },
  { id: "cybersecurity", label: "Cybersecurity" },
  { id: "fintech", label: "Fintech" },
  { id: "healthcare", label: "Healthcare" },
  { id: "climate", label: "Climate" },
  { id: "social_impact", label: "Social impact" },
  { id: "education", label: "Education" },
  { id: "data", label: "Data science" },
  { id: "open", label: "Open innovation" }
];
var PERKS = [
  { id: "beginner_friendly", label: "Beginner friendly" },
  { id: "cash_prizes", label: "Cash prizes" },
  { id: "scholarships", label: "Scholarships" },
  { id: "internships", label: "Internship opportunities" },
  { id: "hardware_prizes", label: "Hardware prizes" },
  { id: "travel_assistance", label: "Travel assistance" },
  { id: "accommodation", label: "Accommodation" }
];
var REGION_CODES = {
  north_america: "US CA BM GL PM",
  latin_america: "MX GT BZ SV HN NI CR PA CU DO HT JM BS BB TT AG DM GD KN LC VC PR VI VG AI AW CW SX BQ KY TC MS GP MQ BL MF CO VE EC PE BO PY UY AR CL BR GY SR GF FK",
  europe: "GB IE FR DE NL BE LU CH AT IT ES PT AD MC SM VA MT DK NO SE FI IS EE LV LT PL CZ SK HU SI HR BA RS ME MK AL GR BG RO MD UA BY RU XK CY LI FO GI IM JE GG AX",
  middle_east_africa: "TR IL PS JO LB SY IQ IR SA AE QA BH KW OM YE EG LY TN DZ MA EH SD SS ET ER DJ SO KE UG RW BI TZ MZ MW ZM ZW BW NA ZA LS SZ AO CD CG GA GQ CM CF TD NE NG BJ TG GH CI LR SL GN GW SN GM ML BF MR CV ST MG MU SC KM RE YT",
  south_asia: "IN PK BD LK NP BT MV AF",
  east_asia: "CN JP KR KP TW HK MO MN",
  southeast_asia: "SG MY ID TH VN PH KH LA MM BN TL",
  oceania: "AU NZ FJ PG SB VU WS TO KI TV NR PW FM MH NC PF CK NU"
};
var COUNTRY_TO_REGION = /* @__PURE__ */ new Map();
for (const [region, codes] of Object.entries(REGION_CODES)) {
  for (const code of codes.split(" ")) COUNTRY_TO_REGION.set(code, region);
}
function regionForCountry(countryCode) {
  if (!countryCode) return null;
  return COUNTRY_TO_REGION.get(countryCode.toUpperCase()) ?? null;
}

// src/ingest/normalize.ts
function slugify(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
}
function nameKey(name) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(19|20)\d{2}\b/g, " ").replace(/[^a-z0-9]+/g, "");
}
var SHARED_HOSTS = /* @__PURE__ */ new Set([
  "linktr.ee",
  "forms.gle",
  "docs.google.com",
  "sites.google.com",
  "bit.ly",
  "tinyurl.com",
  "lu.ma",
  "luma.com",
  "eventbrite.com",
  "instagram.com",
  "discord.gg",
  "discord.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "linkedin.com",
  "github.com",
  "notion.so",
  "devpost.com",
  "mlh.io",
  "hackclub.com",
  "typeform.com",
  "tally.so"
]);
function identifyingHost(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return SHARED_HOSTS.has(host) ? null : host;
  } catch {
    return null;
  }
}
function cleanUrl(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
var cleanText = (v, max = 2e4) => typeof v === "string" && v.trim() ? v.trim().replace(/\s+\n/g, "\n").slice(0, max) : null;
var cleanInt = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;
var instant = (v) => isValidInstant(v) ? new Date(v).toISOString() : null;
function isTimeZone(tz) {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
function validateRecord(input) {
  const warnings = [];
  const name = cleanText(input.name, 200);
  if (!name) return { record: null, warnings: ["missing name"] };
  if (!input.externalId) return { record: null, warnings: ["missing external id"] };
  if (!["online", "in_person", "hybrid"].includes(input.format)) return { record: null, warnings: ["invalid format"] };
  const r = { ...input, name };
  for (const key of ["startAt", "endAt", "registrationDeadlineAt", "submissionDeadlineAt"]) {
    const raw = input[key];
    const v = instant(raw);
    if (raw && !v) warnings.push(`${key}: invalid date ${JSON.stringify(raw)}`);
    r[key] = v;
  }
  if (r.startAt && r.endAt && Date.parse(r.endAt) < Date.parse(r.startAt)) {
    warnings.push("endAt before startAt; dropped endAt");
    r.endAt = null;
  }
  if (!r.startAt && !r.submissionDeadlineAt) return { record: null, warnings: [...warnings, "no usable dates"] };
  r.submissionDeadlineVerified = Boolean(input.submissionDeadlineVerified && r.submissionDeadlineAt);
  r.registrationDeadlineVerified = Boolean(input.registrationDeadlineVerified && r.registrationDeadlineAt);
  if (r.submissionDeadlineVerified && !cleanUrl(input.submissionDeadlineSource)) {
    warnings.push("verified submission deadline without a source URL; marked unverified");
    r.submissionDeadlineVerified = false;
  }
  r.submissionDeadlineSource = cleanUrl(input.submissionDeadlineSource);
  if (r.timezone && !isTimeZone(r.timezone)) {
    warnings.push(`invalid timezone ${r.timezone}`);
    r.timezone = null;
  }
  for (const key of ["websiteUrl", "registrationUrl", "rulesUrl", "logoUrl", "sourceUrl"]) {
    const raw = input[key];
    const v = cleanUrl(raw);
    if (raw && !v) warnings.push(`${key}: invalid URL`);
    r[key] = v;
  }
  for (const key of ["organizer", "summary", "venue", "city", "state", "country", "theme", "prizeSummary"]) {
    r[key] = cleanText(input[key], key === "summary" ? 400 : 300);
  }
  for (const key of ["description", "deliverables", "judgingCriteria"]) r[key] = cleanText(input[key]);
  r.countryCode = typeof input.countryCode === "string" && /^[A-Za-z]{2}$/.test(input.countryCode) ? input.countryCode.toUpperCase() : null;
  r.teamMin = cleanInt(input.teamMin, 1, 50);
  r.teamMax = cleanInt(input.teamMax, 1, 50);
  if (r.teamMin && r.teamMax && r.teamMin > r.teamMax) {
    warnings.push("teamMin > teamMax; dropped both");
    r.teamMin = r.teamMax = null;
  }
  r.soloAllowed = typeof input.soloAllowed === "boolean" ? input.soloAllowed : null;
  const categoryIds = new Set(CATEGORIES.map((c) => c.id));
  const perkIds = new Set(PERKS.map((p) => p.id));
  r.categories = (input.categories ?? []).filter((c) => categoryIds.has(c));
  r.perks = (input.perks ?? []).filter((p) => perkIds.has(p));
  r.technologies = (input.technologies ?? []).map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  r.cost = input.cost === "free" || input.cost === "paid" ? input.cost : null;
  return { record: r, warnings };
}

// src/ingest/store.ts
import { randomUUID } from "node:crypto";

// src/ingest/merge.ts
var OVERRIDABLE_FIELDS = [
  "name",
  "organizer",
  "summary",
  "description",
  "websiteUrl",
  "registrationUrl",
  "rulesUrl",
  "startAt",
  "endAt",
  "timezone",
  "registrationDeadlineAt",
  "registrationDeadlineVerified",
  "submissionDeadlineAt",
  "submissionDeadlineVerified",
  "submissionDeadlineSource",
  "format",
  "venue",
  "city",
  "state",
  "country",
  "countryCode",
  "teamMin",
  "teamMax",
  "soloAllowed",
  "categories",
  "technologies",
  "perks",
  "cost",
  "theme",
  "deliverables",
  "judgingCriteria",
  "prizeSummary",
  "prizes",
  "schedule",
  "hidden"
];
var SCALARS = [
  "name",
  "organizer",
  "summary",
  "description",
  "websiteUrl",
  "registrationUrl",
  "rulesUrl",
  "startAt",
  "endAt",
  "timezone",
  "format",
  "venue",
  "city",
  "state",
  "country",
  "countryCode",
  "latitude",
  "longitude",
  "teamMin",
  "teamMax",
  "soloAllowed",
  "cost",
  "theme",
  "deliverables",
  "judgingCriteria",
  "prizeSummary",
  "prizes",
  "schedule",
  "logoUrl"
];
var LISTS = ["categories", "technologies", "perks"];
var present = (v) => v !== void 0 && v !== null && v !== "";
function mergeRecords(records, overrides) {
  const ranked = [...records].sort(
    (a, b) => b.priority - a.priority || Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt)
  );
  const out = {};
  for (const key of SCALARS) out[key] = ranked.map((r) => r.record[key]).find(present) ?? null;
  for (const key of LISTS) out[key] = ranked.map((r) => r.record[key]).find((v) => Array.isArray(v) && v.length) ?? [];
  const deadline = (atKey, flag) => {
    const verified = ranked.find((r) => r.record[flag] && r.record[atKey]);
    const any = verified ?? ranked.find((r) => r.record[atKey]);
    return { at: any?.record[atKey] ?? null, verified: Boolean(verified), from: any };
  };
  const sub = deadline("submissionDeadlineAt", "submissionDeadlineVerified");
  out.submissionDeadlineAt = sub.at;
  out.submissionDeadlineVerified = sub.verified;
  out.submissionDeadlineSource = sub.verified ? sub.from?.record.submissionDeadlineSource ?? null : null;
  const reg = deadline("registrationDeadlineAt", "registrationDeadlineVerified");
  out.registrationDeadlineAt = reg.at;
  out.registrationDeadlineVerified = reg.verified;
  out.hidden = false;
  for (const [field, value] of Object.entries(overrides)) {
    if (OVERRIDABLE_FIELDS.includes(field)) out[field] = value;
  }
  if (out.format === "online") {
    out.city = out.state = out.venue = out.country = out.countryCode = null;
    out.latitude = out.longitude = null;
  }
  out.region = regionForCountry(out.countryCode);
  return out;
}

// src/ingest/store.ts
var DAY2 = 864e5;
var json = (v) => JSON.stringify(v ?? null);
var bool = (v) => v === null || v === void 0 ? null : v ? 1 : 0;
function withinDays(a, b, days) {
  if (!a || !b) return false;
  return Math.abs(Date.parse(a) - Date.parse(b)) <= days * DAY2;
}
function findExistingEvent(db, r) {
  const bySource = db.prepare("SELECT event_id FROM event_sources WHERE source = ? AND external_id = ?").get(r.source, r.externalId);
  if (bySource) return bySource.event_id;
  const host = identifyingHost(r.websiteUrl) ?? identifyingHost(r.registrationUrl);
  if (host) {
    const rows2 = db.prepare("SELECT id, start_at FROM events WHERE website_host = ?").all(host);
    const match = rows2.find((row) => withinDays(row.start_at, r.startAt, 3) || !row.start_at && !r.startAt);
    if (match) return match.id;
  }
  const rows = db.prepare("SELECT id, start_at FROM events WHERE dedupe_key = ?").all(nameKey(r.name));
  return rows.find((row) => withinDays(row.start_at, r.startAt, 7))?.id ?? null;
}
function uniqueSlug(db, name, startAt) {
  const year = startAt ? new Date(startAt).getUTCFullYear() : null;
  const base = slugify(year && !name.includes(String(year)) ? `${name} ${year}` : name);
  let slug = base;
  for (let i = 2; db.prepare("SELECT 1 FROM events WHERE slug = ?").get(slug); i++) slug = `${base}-${i}`;
  return slug;
}
function upsertSourceRecord(db, r, raw, now) {
  const ts = now.toISOString();
  const knownLink = db.prepare("SELECT event_id FROM event_sources WHERE source = ? AND external_id = ?").get(r.source, r.externalId);
  let eventId = knownLink?.event_id ?? findExistingEvent(db, r);
  let created = false;
  if (!eventId) {
    eventId = randomUUID();
    created = true;
    db.prepare(
      `INSERT INTO events (id, slug, name, format, dedupe_key, website_host, start_at, first_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      eventId,
      uniqueSlug(db, r.name, r.startAt),
      r.name,
      r.format,
      nameKey(r.name),
      identifyingHost(r.websiteUrl) ?? identifyingHost(r.registrationUrl),
      r.startAt ?? null,
      ts,
      ts,
      ts
    );
  }
  const { eligibilityClaim: _claim, ...normalized } = r;
  db.prepare(
    `INSERT INTO event_sources (event_id, source, external_id, source_url, normalized, raw, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, external_id) DO UPDATE SET
       source_url = excluded.source_url, normalized = excluded.normalized, raw = excluded.raw, last_seen_at = excluded.last_seen_at`
  ).run(eventId, r.source, r.externalId, r.sourceUrl, JSON.stringify(normalized), json(raw), ts, ts);
  return { eventId, created, mergedIntoExisting: !knownLink && !created };
}
function loadOverrides(db, eventId) {
  const rows = db.prepare("SELECT field, value FROM event_overrides WHERE event_id = ?").all(eventId);
  return Object.fromEntries(rows.map((r) => [r.field, JSON.parse(r.value)]));
}
function loadRankedRecords(db, eventId, priorities) {
  const rows = db.prepare("SELECT source, normalized, last_seen_at FROM event_sources WHERE event_id = ?").all(eventId);
  return rows.map((row) => ({
    record: JSON.parse(row.normalized),
    priority: priorities[row.source] ?? 0,
    lastSeenAt: row.last_seen_at
  }));
}
function materializeEvent(db, eventId, priorities, now) {
  const records = loadRankedRecords(db, eventId, priorities);
  if (!records.length) return;
  const m = mergeRecords(records, loadOverrides(db, eventId));
  if (!m.summary) m.summary = officialMetaDescription(db, m.websiteUrl ?? m.registrationUrl ?? null);
  db.prepare(
    `UPDATE events SET
      name = ?, organizer = ?, summary = ?, description = ?, website_url = ?, registration_url = ?, rules_url = ?,
      start_at = ?, end_at = ?, timezone = ?,
      registration_deadline_at = ?, registration_deadline_status = ?,
      submission_deadline_at = ?, submission_deadline_status = ?, submission_deadline_source = ?,
      format = ?, venue = ?, city = ?, state = ?, country = ?, country_code = ?, region = ?, latitude = ?, longitude = ?,
      team_min = ?, team_max = ?, solo_allowed = ?, categories = ?, technologies = ?, perks = ?, cost = ?,
      theme = ?, deliverables = ?, judging_criteria = ?, prize_summary = ?, prizes = ?, schedule = ?, logo_url = ?,
      website_host = ?, hidden = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    m.name,
    m.organizer ?? null,
    m.summary ?? null,
    m.description ?? null,
    m.websiteUrl ?? null,
    m.registrationUrl ?? null,
    m.rulesUrl ?? null,
    m.startAt ?? null,
    m.endAt ?? null,
    m.timezone ?? null,
    m.registrationDeadlineAt ?? null,
    m.registrationDeadlineVerified ? "verified" : "unverified",
    m.submissionDeadlineAt ?? null,
    m.submissionDeadlineVerified ? "verified" : "unverified",
    m.submissionDeadlineSource ?? null,
    m.format,
    m.venue ?? null,
    m.city ?? null,
    m.state ?? null,
    m.country ?? null,
    m.countryCode ?? null,
    m.region,
    m.latitude ?? null,
    m.longitude ?? null,
    m.teamMin ?? null,
    m.teamMax ?? null,
    bool(m.soloAllowed),
    json(m.categories ?? []),
    json(m.technologies ?? []),
    json(m.perks ?? []),
    m.cost ?? null,
    m.theme ?? null,
    m.deliverables ?? null,
    m.judgingCriteria ?? null,
    m.prizeSummary ?? null,
    m.prizes ? json(m.prizes) : null,
    m.schedule ? json(m.schedule) : null,
    m.logoUrl ?? null,
    identifyingHost(m.websiteUrl) ?? identifyingHost(m.registrationUrl),
    m.hidden ? 1 : 0,
    now.toISOString(),
    eventId
  );
}
function officialMetaDescription(db, url) {
  if (!url) return null;
  const row = db.prepare("SELECT text_excerpt FROM page_checks WHERE url = ?").get(url);
  if (!row?.text_excerpt) return null;
  const meta = JSON.parse(row.text_excerpt).metaDescription;
  if (!meta || meta.length < 25 || /create (next|react) app|vite \+|web site created using|powered by (wix|webflow)/i.test(meta)) return null;
  return meta.slice(0, 400);
}
function loadEligibility(db, eventId) {
  const row = db.prepare("SELECT * FROM eligibility WHERE event_id = ?").get(eventId);
  if (!row) return null;
  return { eligibility: rowToEligibility(row), manual: row.manual === 1, contentHash: row.content_hash ?? null };
}
function rowToEligibility(row) {
  const b = (v) => v === null || v === void 0 ? null : v === 1;
  return {
    status: row.status,
    highSchoolAllowed: b(row.high_school_allowed),
    educationLevels: JSON.parse(row.education_levels ?? "[]"),
    minAge: row.min_age ?? null,
    maxAge: row.max_age ?? null,
    grades: JSON.parse(row.grades ?? "[]"),
    geographicRestrictions: row.geographic_restrictions ?? null,
    internationalAllowed: b(row.international_allowed),
    requiresCollegeEnrollment: b(row.requires_college_enrollment),
    method: row.method,
    evidence: JSON.parse(row.evidence ?? "[]"),
    sourceUrl: row.source_url ?? null,
    checkedAt: row.checked_at,
    notes: row.notes ?? null,
    needsReview: row.needs_review === 1
  };
}
function saveEligibility(db, eventId, e, manual, contentHash) {
  db.prepare(
    `INSERT INTO eligibility (event_id, status, high_school_allowed, education_levels, min_age, max_age, grades,
       geographic_restrictions, international_allowed, requires_college_enrollment, method, evidence, source_url,
       content_hash, checked_at, notes, manual, needs_review)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_id) DO UPDATE SET
       status = excluded.status, high_school_allowed = excluded.high_school_allowed,
       education_levels = excluded.education_levels, min_age = excluded.min_age, max_age = excluded.max_age,
       grades = excluded.grades, geographic_restrictions = excluded.geographic_restrictions,
       international_allowed = excluded.international_allowed,
       requires_college_enrollment = excluded.requires_college_enrollment, method = excluded.method,
       evidence = excluded.evidence, source_url = excluded.source_url, content_hash = excluded.content_hash,
       checked_at = excluded.checked_at, notes = excluded.notes, manual = excluded.manual,
       needs_review = excluded.needs_review`
  ).run(
    eventId,
    e.status,
    bool(e.highSchoolAllowed),
    json(e.educationLevels),
    e.minAge,
    e.maxAge,
    json(e.grades),
    e.geographicRestrictions,
    bool(e.internationalAllowed),
    bool(e.requiresCollegeEnrollment),
    e.method,
    json(e.evidence),
    e.sourceUrl,
    contentHash,
    e.checkedAt,
    e.notes,
    manual ? 1 : 0,
    e.needsReview ? 1 : 0
  );
}

// src/ingest/pipeline.ts
var PAGE_CACHE_HOURS = 20;
var MAX_LINKED_PAGES = 2;
var CONCURRENCY = 4;
function sourcePriorities(sources) {
  return Object.fromEntries(sources.map((s) => [s.id, s.priority]));
}
function lastSuccess(db, source) {
  const row = db.prepare("SELECT finished_at FROM ingestion_runs WHERE source = ? AND status = 'succeeded' ORDER BY id DESC LIMIT 1").get(source);
  return row?.finished_at ?? null;
}
async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
async function officialPages(db, url, opts) {
  const cached = db.prepare("SELECT * FROM page_checks WHERE url = ?").get(url);
  const fresh = cached && opts.now.getTime() - Date.parse(cached.checked_at) < PAGE_CACHE_HOURS * 36e5;
  if (fresh && !opts.force) {
    const stored = JSON.parse(cached.text_excerpt || "{}");
    return {
      evidence: { url, ok: cached.ok === 1, error: cached.error ?? null, contentHash: cached.content_hash ?? null, pages: stored.pages ?? [] },
      metaDescription: stored.metaDescription ?? null
    };
  }
  const main = await fetchPage(url, opts.fetchImpl);
  const mainText = [main.metaDescription, main.text].filter(Boolean).join("\n");
  const pages = main.ok ? [{ url: main.finalUrl ?? url, text: mainText }] : [];
  if (main.ok) {
    const origin = new URL(main.finalUrl ?? url).origin;
    const linked = [...new Map(
      main.links.filter((l) => l.href.startsWith(origin) && /rules|faq|eligib|terms|about|participat/i.test(l.href + " " + l.text)).map((l) => [l.href.split("#")[0], l])
    ).keys()].filter((href) => href !== (main.finalUrl ?? url)).slice(0, MAX_LINKED_PAGES);
    for (const href of linked) {
      const p = await fetchPage(href, opts.fetchImpl);
      if (p.ok && p.text) pages.push({ url: p.finalUrl ?? href, text: p.text });
    }
  }
  const combined = pages.map((p) => p.text).join("\n");
  const contentHash = main.ok ? hashText(combined) : null;
  db.prepare(
    `INSERT INTO page_checks (url, status_code, ok, final_url, content_hash, text_excerpt, robots_allowed, error, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET status_code = excluded.status_code, ok = excluded.ok, final_url = excluded.final_url,
       content_hash = excluded.content_hash, text_excerpt = excluded.text_excerpt, robots_allowed = excluded.robots_allowed,
       error = excluded.error, checked_at = excluded.checked_at`
  ).run(
    url,
    main.statusCode,
    main.ok ? 1 : 0,
    main.finalUrl,
    contentHash,
    JSON.stringify({ pages: pages.map((p) => ({ url: p.url, text: p.text.slice(0, 6e4) })), metaDescription: main.metaDescription }),
    main.robotsAllowed ? 1 : 0,
    main.error,
    opts.now.toISOString()
  );
  return { evidence: { url, ok: main.ok, error: main.error, contentHash, pages }, metaDescription: main.metaDescription };
}
async function runIngestion(db, sources, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? (() => {
  });
  const priorities = { ...options.extraPriorities, ...sourcePriorities(sources) };
  const touched = /* @__PURE__ */ new Map();
  const report = { sources: [], eventsChecked: 0, eligibility: {}, listing: {} };
  for (const source of sources) {
    const stats = { source: source.id, fetched: 0, rejected: 0, warnings: 0, created: 0, updated: 0, mergedDuplicates: 0 };
    report.sources.push(stats);
    const last = lastSuccess(db, source.id);
    if (!options.force && last && now.getTime() - Date.parse(last) < source.minIntervalHours * 36e5) {
      stats.skipped = `ran ${Math.round((now.getTime() - Date.parse(last)) / 6e4)} min ago (minimum interval ${source.minIntervalHours}h)`;
      continue;
    }
    const run = db.prepare("INSERT INTO ingestion_runs (source, started_at, status) VALUES (?, ?, 'running')").run(source.id, now.toISOString());
    try {
      const records = await source.fetchRecords({ fetch: fetchImpl, now, log });
      stats.fetched = records.length;
      transaction(db, () => {
        for (const { record, raw } of records) {
          const { record: valid, warnings } = validateRecord(record);
          stats.warnings += warnings.length;
          for (const w of warnings) log(`[${source.id}] ${record.name || record.externalId}: ${w}`);
          if (!valid) {
            stats.rejected++;
            continue;
          }
          const res = upsertSourceRecord(db, valid, raw, now);
          if (res.created) stats.created++;
          else stats.updated++;
          if (res.mergedIntoExisting) stats.mergedDuplicates++;
          const prior = touched.get(res.eventId);
          touched.set(res.eventId, prior?.kind === "attested" ? prior : valid.eligibilityClaim ?? prior);
        }
      });
      db.prepare("UPDATE ingestion_runs SET status = 'succeeded', finished_at = ?, stats = ? WHERE id = ?").run(
        (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(stats),
        run.lastInsertRowid
      );
    } catch (err) {
      stats.error = err instanceof Error ? err.message : String(err);
      log(`[${source.id}] failed: ${stats.error}`);
      db.prepare("UPDATE ingestion_runs SET status = 'failed', finished_at = ?, stats = ?, error = ? WHERE id = ?").run(
        (/* @__PURE__ */ new Date()).toISOString(),
        JSON.stringify(stats),
        stats.error,
        run.lastInsertRowid
      );
    }
  }
  const ids = [...touched.keys()];
  for (const id of ids) materializeEvent(db, id, priorities, now);
  await mapLimit(ids, CONCURRENCY, async (id) => {
    const ev = db.prepare("SELECT website_url, registration_url, summary FROM events WHERE id = ?").get(id);
    const url = ev.website_url ?? ev.registration_url;
    const checked = url ? await officialPages(db, url, { fetchImpl, force: Boolean(options.force), now }) : null;
    const decision = decideEligibility(touched.get(id), checked?.evidence ?? null, loadEligibility(db, id), now);
    saveEligibility(db, id, decision.eligibility, decision.manual, decision.contentHash);
    if (!ev.summary && checked?.metaDescription) materializeEvent(db, id, priorities, now);
    db.prepare("UPDATE events SET last_verified_at = ? WHERE id = ?").run(now.toISOString(), id);
    report.eventsChecked++;
  });
  for (const row of db.prepare("SELECT status, COUNT(*) n FROM eligibility GROUP BY status").all()) {
    report.eligibility[row.status] = row.n;
  }
  const rows = db.prepare("SELECT submission_deadline_at, submission_deadline_status, start_at, end_at FROM events").all();
  for (const r of rows) {
    const state = listingState({
      submissionDeadlineAt: r.submission_deadline_at ?? null,
      submissionDeadlineStatus: r.submission_deadline_status ?? "unverified",
      startAt: r.start_at ?? null,
      endAt: r.end_at ?? null
    }, now);
    report.listing[state] = (report.listing[state] ?? 0) + 1;
  }
  return report;
}

// src/ingest/sources/hackclub.ts
var API_URL = "https://hackathons.hackclub.com/api/events/upcoming/";
var DIRECTORY_URL = "https://hackathons.hackclub.com/";
function isHackClubEvent(v) {
  const e = v;
  return Boolean(e && typeof e.id === "string" && typeof e.name === "string" && typeof e.start === "string");
}
var hackClubSource = {
  id: "hackclub",
  label: "Hack Club Hackathons directory",
  priority: 50,
  minIntervalHours: 6,
  async fetchRecords(ctx) {
    const res = await ctx.fetch(API_URL, {
      headers: { accept: "application/json", "user-agent": "HackathonDigestBot/0.1" },
      signal: AbortSignal.timeout(2e4)
    });
    if (!res.ok) throw new Error(`Hack Club API responded HTTP ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error("Hack Club API returned an unexpected shape");
    const events = body.filter(isHackClubEvent);
    if (events.length !== body.length) ctx.log(`[hackclub] ignored ${body.length - events.length} malformed entries`);
    return events.map((e) => {
      const format = e.hybrid ? "hybrid" : e.virtual ? "online" : "in_person";
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
            statement: "Listed in Hack Club's directory of upcoming high school hackathons."
          }
        }
      };
    });
  }
};

// src/ingest/sources/curated.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname as dirname2, join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var DIR = resolve2(dirname2(fileURLToPath2(import.meta.url)), "../../../data/curated");
function parseCuratedEntry(entry, file) {
  const where = `${file}: ${entry.name ?? entry.externalId ?? "(unnamed)"}`;
  const el = entry.eligibility;
  if (!entry.externalId) throw new Error(`${where}: externalId is required`);
  if (el) {
    if (!["verified", "unclear", "ineligible"].includes(el.status)) throw new Error(`${where}: eligibility.status is invalid`);
    if (el.status === "verified" && !el.evidence?.some((ev) => ev.url && ev.quote)) {
      throw new Error(`${where}: verified eligibility needs at least one evidence entry with url and quote from the official rules`);
    }
    if (!el.checkedAt || Number.isNaN(Date.parse(el.checkedAt))) throw new Error(`${where}: eligibility.checkedAt is required`);
  }
  if (entry.submissionDeadlineVerified && !entry.submissionDeadlineSource) {
    throw new Error(`${where}: a verified submission deadline needs submissionDeadlineSource`);
  }
  const { eligibility, ...rest } = entry;
  return {
    raw: entry,
    record: {
      ...rest,
      source: "curated",
      sourceUrl: entry.sourceUrl ?? entry.websiteUrl ?? null,
      ...eligibility && { eligibilityClaim: { kind: "attested", eligibility: { ...eligibility, method: eligibility.method ?? "manual" } } }
    }
  };
}
var curatedSource = {
  id: "curated",
  label: "Reviewer-curated events",
  priority: 100,
  minIntervalHours: 0,
  async fetchRecords() {
    let files;
    try {
      files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const out = [];
    for (const file of files) {
      const entries = JSON.parse(readFileSync(join2(DIR, file), "utf8"));
      if (!Array.isArray(entries)) throw new Error(`${file}: expected a JSON array`);
      for (const entry of entries) out.push(parseCuratedEntry(entry, file));
    }
    return out;
  }
};

// src/ingest/sources/index.ts
var SOURCES = [curatedSource, hackClubSource];
var SOURCE_PRIORITIES = {
  ...Object.fromEntries(SOURCES.map((s) => [s.id, s.priority])),
  submission: 80,
  // organizer submissions, written when a reviewer approves them
  digest: 60
  // hackathons recorded by the weekly email routine
};

// src/functions/sync.ts
function supabaseAdmin(url, secretKey, fetchImpl = fetch) {
  const base = `${url.replace(/\/(rest\/v1\/?)?$/, "")}/rest/v1`;
  const headers = { apikey: secretKey, "content-type": "application/json" };
  const call = async (path, init) => {
    const res = await fetchImpl(`${base}/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
    return res;
  };
  return {
    async select(table, query) {
      return await (await call(`${table}?${query}`, { method: "GET" })).json();
    },
    async upsert(table, rows, onConflict) {
      for (let i = 0; i < rows.length; i += 200) {
        await call(`${table}?on_conflict=${onConflict}`, {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows.slice(i, i + 200))
        });
      }
    },
    async insert(table, rows) {
      await call(table, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    },
    async update(table, filter, patch) {
      await call(`${table}?${filter}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
    }
  };
}
var BOOL = /* @__PURE__ */ new Set(["solo_allowed", "hidden", "is_mock", "high_school_allowed", "international_allowed", "requires_college_enrollment", "manual", "needs_review"]);
var JSON_COLS = /* @__PURE__ */ new Set(["categories", "technologies", "perks", "prizes", "schedule", "education_levels", "grades", "evidence", "normalized", "raw", "value"]);
var TS = /* @__PURE__ */ new Set(["start_at", "end_at", "registration_deadline_at", "submission_deadline_at", "first_seen_at", "last_verified_at", "created_at", "updated_at", "checked_at", "last_seen_at"]);
function toSqlite(row, skip = []) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.includes(k)) continue;
    if (v === null || v === void 0) out[k] = null;
    else if (BOOL.has(k)) out[k] = v ? 1 : 0;
    else if (JSON_COLS.has(k)) out[k] = JSON.stringify(v);
    else if (TS.has(k)) out[k] = new Date(String(v)).toISOString();
    else out[k] = v;
  }
  return out;
}
function toPostgres(row, skip = []) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (skip.includes(k)) continue;
    if (v === null || v === void 0) out[k] = null;
    else if (BOOL.has(k)) out[k] = v === 1 || v === true;
    else if (JSON_COLS.has(k)) out[k] = typeof v === "string" ? JSON.parse(v) : v;
    else out[k] = v;
  }
  return out;
}
function insertRows(db, table, rows) {
  for (const r of rows) {
    const cols = Object.keys(r);
    db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
      ...cols.map((c) => r[c])
    );
  }
}
var str = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
function digestSource(pending) {
  return {
    id: "digest",
    label: "Hackathon Digest email",
    priority: SOURCE_PRIORITIES.digest ?? 60,
    minIntervalHours: 0,
    async fetchRecords() {
      return pending.map((s) => {
        const p = s.payload ?? {};
        const format = ["online", "in_person", "hybrid"].includes(p.format) ? p.format : "online";
        const record = {
          source: "digest",
          externalId: `digest-${s.id}`,
          sourceUrl: str(p.websiteUrl),
          name: String(p.name ?? ""),
          organizer: str(p.organizer),
          summary: str(p.summary),
          websiteUrl: str(p.websiteUrl),
          registrationUrl: str(p.registrationUrl),
          rulesUrl: str(p.rulesUrl),
          startAt: str(p.startAt),
          endAt: str(p.endAt),
          format,
          city: str(p.city),
          state: str(p.state),
          country: str(p.country),
          countryCode: str(p.countryCode)
          // No eligibility claim and no verified deadline: the pipeline checks the official site,
          // and the event is published only if high school eligibility is confirmed there.
        };
        return { record, raw: p };
      });
    }
  };
}
async function syncSupabase(sb, schemaSql, options = {}) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const db = new DatabaseSync2(":memory:");
  db.exec(schemaSql);
  const [events, eligibility, sources, overrides, pending] = await Promise.all([
    sb.select("events", "select=*&limit=10000"),
    sb.select("eligibility", "select=*&limit=10000"),
    sb.select("event_sources", "select=*&limit=20000"),
    sb.select("event_overrides", "select=*&limit=20000"),
    sb.select("submissions", "select=id,payload&status=eq.pending&payload->>source=eq.email-digest&limit=500")
  ]);
  insertRows(db, "events", events.map((r) => toSqlite(r)));
  insertRows(db, "eligibility", eligibility.map((r) => toSqlite(r)));
  insertRows(db, "event_sources", sources.map((r) => toSqlite(r, ["id"])));
  insertRows(db, "event_overrides", overrides.map((r) => toSqlite(r)));
  const report = await runIngestion(db, [hackClubSource, digestSource(pending)], {
    force: true,
    now,
    fetchImpl: options.fetchImpl,
    extraPriorities: SOURCE_PRIORITIES,
    log: options.log
  });
  const all = (table) => db.prepare(`SELECT * FROM ${table}`).all();
  await sb.upsert("events", all("events").map((r) => toPostgres(r)), "id");
  await sb.upsert("eligibility", all("eligibility").map((r) => toPostgres(r)), "event_id");
  await sb.upsert("event_sources", all("event_sources").map((r) => toPostgres(r, ["id"])), "source,external_id");
  const digestProcessed = [];
  for (const s of pending) {
    const link = db.prepare("SELECT s.event_id, el.status FROM event_sources s LEFT JOIN eligibility el ON el.event_id = s.event_id WHERE s.source = 'digest' AND s.external_id = ?").get(`digest-${s.id}`);
    const name = String((s.payload ?? {}).name ?? "");
    digestProcessed.push({ id: s.id, name, eventId: link?.event_id ?? null, status: link?.status ?? null });
    if (!link) continue;
    await sb.update("submissions", `id=eq.${s.id}`, {
      status: "approved",
      event_id: link.event_id,
      reviewed_at: now.toISOString(),
      review_note: link.status === "verified" ? "Imported automatically from the email digest; high school eligibility confirmed on the official site." : `Imported automatically from the email digest; eligibility is "${link.status ?? "unchecked"}", so it stays unpublished until reviewed.`
    });
  }
  await sb.insert("ingestion_runs", [
    {
      source: "supabase-sync",
      started_at: now.toISOString(),
      finished_at: (/* @__PURE__ */ new Date()).toISOString(),
      status: report.sources.some((s) => s.error) ? "failed" : "succeeded",
      stats: { report, digestProcessed },
      error: report.sources.map((s) => s.error).filter(Boolean).join("; ") || null
    }
  ]);
  const counts = Object.fromEntries(
    ["events", "eligibility", "event_sources"].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n])
  );
  return { report, digestProcessed, counts };
}

// src/functions/cron.ts
var MIN_MINUTES_BETWEEN_RUNS = 10;
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body, null, 2));
}
async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return send(res, 500, { error: "SUPABASE_URL and SUPABASE_SECRET_KEY must be set in Vercel." });
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "Unauthorized" });
  const sb = supabaseAdmin(url, key);
  const last = await sb.select("ingestion_runs", "select=finished_at&source=eq.supabase-sync&status=eq.succeeded&order=finished_at.desc&limit=1");
  const lastAt = last[0]?.finished_at ? Date.parse(String(last[0].finished_at)) : 0;
  if (Date.now() - lastAt < MIN_MINUTES_BETWEEN_RUNS * 6e4) {
    return send(res, 429, { skipped: `Last sync finished ${Math.round((Date.now() - lastAt) / 6e4)} min ago.` });
  }
  try {
    const result = await syncSupabase(sb, init_default, { log: (m) => console.log(m) });
    return send(res, 200, {
      ok: true,
      sources: result.report.sources,
      eligibility: result.report.eligibility,
      listing: result.report.listing,
      digestProcessed: result.digestProcessed,
      counts: result.counts
    });
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}
export {
  handler as default
};
