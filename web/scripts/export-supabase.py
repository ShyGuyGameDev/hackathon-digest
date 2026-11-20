"""Regenerates supabase/schema_and_data.sql from data/hackathons.db.

Usage (from web/): npm run ingest && python3 scripts/export-supabase.py
The schema half of the file is kept as-is; only the data section is rebuilt.
"""
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "supabase" / "schema_and_data.sql"
MARKER = "-- Data\n-- ---------------------------------------------------------------------------------------------\n"

TS = {"start_at", "end_at", "registration_deadline_at", "submission_deadline_at", "first_seen_at",
      "last_verified_at", "created_at", "updated_at", "checked_at", "last_seen_at", "reviewed_at"}
BOOL = {"solo_allowed", "hidden", "is_mock", "high_school_allowed", "international_allowed",
        "requires_college_enrollment", "manual", "needs_review"}
JSON = {"categories", "technologies", "perks", "prizes", "schedule", "education_levels", "grades",
        "evidence", "normalized", "raw", "payload", "value"}

def lit(col, v):
    if v is None:
        return "null"
    if col in BOOL:
        return "true" if v else "false"
    if isinstance(v, (int, float)) and col not in JSON:
        return repr(v)
    s = str(v).replace("'", "''")
    if col in JSON:
        return f"'{s}'::jsonb"
    if col in TS:
        return f"'{s}'::timestamptz"
    return f"'{s}'"

def inserts(db, table, conflict, skip=()):
    rows = db.execute(f"select * from {table}").fetchall()
    if not rows:
        return f"-- {table}: no rows yet\n"
    cols = [c for c in rows[0].keys() if c not in skip]
    values = ",\n".join("  (" + ", ".join(lit(c, r[c]) for c in cols) + ")" for r in rows)
    return f"insert into public.{table} ({', '.join(cols)}) values\n{values}\non conflict ({conflict}) do nothing;\n"

db = sqlite3.connect(ROOT / "data" / "hackathons.db")
db.row_factory = sqlite3.Row
schema = OUT.read_text().split(MARKER)[0] + MARKER
data = [
    inserts(db, "events", "id"),
    inserts(db, "eligibility", "event_id"),
    inserts(db, "event_sources", "source, external_id", skip=("id",)),
    inserts(db, "event_overrides", "event_id, field"),
    inserts(db, "submissions", "id", skip=("id",)),
]
OUT.write_text(schema + "\n".join(data) + "\ncommit;\n")
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
