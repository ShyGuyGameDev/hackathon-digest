import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Eligibility } from "../../shared/types.ts";
import type { NormalizedEvent, SourceModule, SourceRecord } from "../types.ts";

// Reviewer-maintained events in data/curated/*.json, researched from official pages.
// Highest priority: this is where a human recorded what the official rules actually say.
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/curated");

type CuratedEntry = Omit<NormalizedEvent, "source" | "eligibilityClaim"> & {
  /** Omit when not checked by a reviewer; the event then goes through the automated check like any other. */
  eligibility?: Omit<Eligibility, "needsReview" | "method"> & { method?: Eligibility["method"] };
};

/** Throws on entries that would publish unverifiable claims; a curated file must be evidence-backed. */
export function parseCuratedEntry(entry: CuratedEntry, file: string): SourceRecord {
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
      ...(eligibility && { eligibilityClaim: { kind: "attested" as const, eligibility: { ...eligibility, method: eligibility.method ?? "manual" } } }),
    },
  };
}

export const curatedSource: SourceModule = {
  id: "curated",
  label: "Reviewer-curated events",
  priority: 100,
  minIntervalHours: 0,
  async fetchRecords() {
    let files: string[];
    try {
      files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const out: SourceRecord[] = [];
    for (const file of files) {
      const entries = JSON.parse(readFileSync(join(DIR, file), "utf8")) as CuratedEntry[];
      if (!Array.isArray(entries)) throw new Error(`${file}: expected a JSON array`);
      for (const entry of entries) out.push(parseCuratedEntry(entry, file));
    }
    return out;
  },
};
