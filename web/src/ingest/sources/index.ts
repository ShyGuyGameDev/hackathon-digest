import type { SourceModule } from "../types.ts";
import { curatedSource } from "./curated.ts";
import { hackClubSource } from "./hackclub.ts";

/**
 * Registered automated sources. To add one, write a module that maps the source's data to
 * NormalizedEvent and list it here; nothing else in the app needs to change.
 *
 * Deliberately NOT included (see docs/RESEARCH.md): Devpost (terms prohibit automated access),
 * MLH and Devfolio (no documented public event API).
 */
export const SOURCES: SourceModule[] = [curatedSource, hackClubSource];

/** Priorities for every origin of records, including ones written outside the ingest loop. */
export const SOURCE_PRIORITIES: Record<string, number> = {
  ...Object.fromEntries(SOURCES.map((s) => [s.id, s.priority])),
  submission: 80, // organizer submissions, written when a reviewer approves them
  digest: 60, // hackathons recorded by the weekly email routine
  research: 55, // hackathons found by the daily research routine
};

export { SOURCE_LABELS } from "../../shared/taxonomy.ts";
