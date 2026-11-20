-- Core schema. Written in portable SQL (SQLite dialect, no SQLite-only features beyond JSON-as-TEXT)
-- so it can be ported to PostgreSQL by swapping TEXT JSON columns for jsonb.

-- Canonical, merged hackathon records. One row per real-world event, however many sources list it.
CREATE TABLE events (
  id                            TEXT PRIMARY KEY,
  slug                          TEXT NOT NULL UNIQUE,
  name                          TEXT NOT NULL,
  organizer                     TEXT,
  summary                       TEXT,
  description                   TEXT,
  website_url                   TEXT,
  registration_url              TEXT,
  rules_url                     TEXT,
  start_at                      TEXT,             -- ISO-8601 UTC
  end_at                        TEXT,
  timezone                      TEXT,             -- IANA zone when known
  registration_deadline_at      TEXT,
  registration_deadline_status  TEXT NOT NULL DEFAULT 'unverified' CHECK (registration_deadline_status IN ('verified','unverified')),
  submission_deadline_at        TEXT,
  submission_deadline_status    TEXT NOT NULL DEFAULT 'unverified' CHECK (submission_deadline_status IN ('verified','unverified')),
  submission_deadline_source    TEXT,             -- where the verified deadline came from
  format                        TEXT NOT NULL CHECK (format IN ('online','in_person','hybrid')),
  venue                         TEXT,
  city                          TEXT,
  state                         TEXT,
  country                       TEXT,
  country_code                  TEXT,
  region                        TEXT,
  latitude                      REAL,
  longitude                     REAL,
  team_min                      INTEGER,
  team_max                      INTEGER,
  solo_allowed                  INTEGER,          -- NULL = not stated
  categories                    TEXT NOT NULL DEFAULT '[]',
  technologies                  TEXT NOT NULL DEFAULT '[]',
  perks                         TEXT NOT NULL DEFAULT '[]',
  cost                          TEXT CHECK (cost IN ('free','paid')),
  theme                         TEXT,
  deliverables                  TEXT,
  judging_criteria              TEXT,
  prize_summary                 TEXT,
  prizes                        TEXT,             -- JSON array or NULL
  schedule                      TEXT,             -- JSON array or NULL
  logo_url                      TEXT,
  dedupe_key                    TEXT NOT NULL,
  website_host                  TEXT,
  hidden                        INTEGER NOT NULL DEFAULT 0,
  is_mock                       INTEGER NOT NULL DEFAULT 0,
  first_seen_at                 TEXT NOT NULL,
  last_verified_at              TEXT,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);
CREATE INDEX events_dedupe_key ON events (dedupe_key);
CREATE INDEX events_website_host ON events (website_host);
CREATE INDEX events_start_at ON events (start_at);

-- Eligibility is kept apart from event facts: it has its own evidence, method and review cycle.
CREATE TABLE eligibility (
  event_id                      TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status                        TEXT NOT NULL CHECK (status IN ('verified','unclear','ineligible')),
  high_school_allowed           INTEGER,
  education_levels              TEXT NOT NULL DEFAULT '[]',
  min_age                       INTEGER,
  max_age                       INTEGER,
  grades                        TEXT NOT NULL DEFAULT '[]',
  geographic_restrictions       TEXT,
  international_allowed         INTEGER,
  requires_college_enrollment   INTEGER,
  method                        TEXT NOT NULL,
  evidence                      TEXT NOT NULL DEFAULT '[]',
  source_url                    TEXT,
  content_hash                  TEXT,             -- hash of the official page text at check time
  checked_at                    TEXT NOT NULL,
  notes                         TEXT,
  manual                        INTEGER NOT NULL DEFAULT 0,
  needs_review                  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX eligibility_status ON eligibility (status);

-- Every place an event was found. (source, external_id) is the stable identity used for updates.
CREATE TABLE event_sources (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id                      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source                        TEXT NOT NULL,
  external_id                   TEXT NOT NULL,
  source_url                    TEXT,
  normalized                    TEXT NOT NULL,    -- the source's normalized record (JSON)
  raw                           TEXT,             -- original payload (JSON) for audits
  first_seen_at                 TEXT NOT NULL,
  last_seen_at                  TEXT NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX event_sources_event ON event_sources (event_id);

-- Reviewer edits. Applied on top of merged source data, so re-ingestion never overwrites them.
CREATE TABLE event_overrides (
  event_id                      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field                         TEXT NOT NULL,
  value                         TEXT NOT NULL,    -- JSON
  note                          TEXT,
  updated_at                    TEXT NOT NULL,
  PRIMARY KEY (event_id, field)
);

-- Cached fetches of official pages (eligibility checks, link checks).
CREATE TABLE page_checks (
  url                           TEXT PRIMARY KEY,
  status_code                   INTEGER,
  ok                            INTEGER NOT NULL,
  final_url                     TEXT,
  content_hash                  TEXT,
  text_excerpt                  TEXT,             -- normalized visible text, capped
  robots_allowed                INTEGER NOT NULL DEFAULT 1,
  error                         TEXT,
  checked_at                    TEXT NOT NULL
);

CREATE TABLE ingestion_runs (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  source                        TEXT NOT NULL,
  started_at                    TEXT NOT NULL,
  finished_at                   TEXT,
  status                        TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  stats                         TEXT,
  error                         TEXT
);

-- Organizer suggestions. Never public until a reviewer approves them.
CREATE TABLE submissions (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at                    TEXT NOT NULL,
  status                        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  payload                       TEXT NOT NULL,
  contact_email                 TEXT,
  review_note                   TEXT,
  reviewed_at                   TEXT,
  event_id                      TEXT REFERENCES events(id) ON DELETE SET NULL
);

CREATE TABLE meta (
  key                           TEXT PRIMARY KEY,
  value                         TEXT NOT NULL
);
