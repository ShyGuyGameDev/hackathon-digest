import type { EducationLevel, Eligibility, Evidence } from "../shared/types.ts";
import type { EligibilityClaim } from "./types.ts";

export interface TextFinding {
  label: string;
  quote: string;
  url: string;
}

export interface TextAnalysis {
  positive: TextFinding[]; // explicit statements that high schoolers may take part
  negative: TextFinding[]; // statements that would exclude them
  minAge: number | null;
  maxAge: number | null;
  levels: EducationLevel[];
}

// Patterns are deliberately narrow: a match must read as an eligibility statement on its own.
const NEGATIVE: [string, RegExp][] = [
  ["High school students excluded", /\bhigh[\s-]?school(?:ers| students?)? (?:are|is) not (?:eligible|allowed|permitted)\b/i],
  ["University students only", /\b(?:only|exclusively) (?:open )?(?:to |for )?(?:current(?:ly enrolled)? )?(?:university|college|undergraduate|graduate|post-?secondary) students\b/i],
  ["University students only", /\b(?:university|college|undergraduate|graduate) students only\b/i],
  ["Requires university enrollment", /\bmust be (?:a )?(?:currently )?(?:enrolled|registered) (?:as a student )?(?:at|in) (?:an? )?(?:accredited )?(?:university|college|post-?secondary)\b/i],
  ["Requires a .edu email", /\b(?:valid|your|a) \.edu (?:email|e-mail|address)\b|\b\.edu (?:email|e-mail) (?:is )?required\b/i],
  ["Must be 18 or older", /\b(?:must|need to) be (?:at least )?18(?: years(?: old| of age)?)?(?: or older)?\b(?! to (?:receive|claim|win))(?! or (?:younger|under))/i],
  ["Must be 18 or older", /\bparticipants? must be (?:aged )?18\+/i],
  ["Adults only", /\b(?:adults only|open only to (?:those|people|individuals) (?:aged )?18)\b/i],
];

const POSITIVE: [string, RegExp][] = [
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
  ["Open to teens", /\b(?:for|open to|welcom(?:e|es|ing)|calling all) teens\b|\bteen-only\b|\bteens aged\b/i],
];

function quoteAround(text: string, index: number, length: number): string {
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1, index - 140);
  let end = text.indexOf("\n", index + length);
  if (end === -1 || end > index + length + 140) end = Math.min(text.length, index + length + 140);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function analyzeText(pages: { url: string; text: string }[]): TextAnalysis {
  const positive: TextFinding[] = [];
  const negative: TextFinding[] = [];
  let minAge: number | null = null;
  let maxAge: number | null = null;
  const levels = new Set<EducationLevel>();
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

export interface PageEvidence {
  url: string;
  ok: boolean;
  error: string | null;
  contentHash: string | null;
  pages: { url: string; text: string }[];
}

export interface ExistingEligibility {
  eligibility: Eligibility;
  manual: boolean;
  contentHash: string | null;
}

export interface EligibilityDecision {
  eligibility: Eligibility;
  manual: boolean;
  contentHash: string | null;
}

const toEvidence = (f: TextFinding): Evidence => ({ url: f.url, quote: f.quote, note: f.label });

/**
 * Decides eligibility status. Rules, in order:
 *  1. Manual verification stands, but is flagged for review if the official page text changed.
 *  2. Reviewer-attested claims (curated file / approved submission) are used as given.
 *  3. Anything excluding high schoolers → "ineligible", or "unclear" if signals conflict.
 *  4. Official site unreachable → "unclear" (can't cross-check).
 *  5. High-school-only directory listing, or explicit wording on the official site → "verified".
 *  6. Otherwise "unclear". Only "verified" events are ever public.
 */
export function decideEligibility(
  claim: EligibilityClaim | undefined,
  page: PageEvidence | null,
  existing: ExistingEligibility | null,
  now: Date,
): EligibilityDecision {
  const checkedAt = now.toISOString();
  const hash = page?.contentHash ?? null;

  if (existing?.manual) {
    const changed = Boolean(hash && existing.contentHash && hash !== existing.contentHash);
    return {
      eligibility: { ...existing.eligibility, needsReview: existing.eligibility.needsReview || changed },
      manual: true,
      contentHash: existing.contentHash ?? hash,
    };
  }

  if (claim?.kind === "attested") {
    return { eligibility: { ...claim.eligibility, needsReview: false }, manual: true, contentHash: hash };
  }

  const analysis = page?.ok ? analyzeText(page.pages) : null;
  const base: Eligibility = {
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
    needsReview: false,
  };
  const directoryEvidence: Evidence[] =
    claim?.kind === "curated_directory" ? [{ url: claim.url, quote: claim.statement, note: claim.directory }] : [];

  if (analysis && analysis.negative.length) {
    const conflicting = analysis.positive.length > 0 || directoryEvidence.length > 0;
    return {
      eligibility: {
        ...base,
        status: conflicting ? "unclear" : "ineligible",
        highSchoolAllowed: conflicting ? null : false,
        requiresCollegeEnrollment: analysis.negative.some((n) => /university|\.edu/i.test(n.label)) || null,
        evidence: [...directoryEvidence, ...analysis.negative.map(toEvidence), ...analysis.positive.map(toEvidence)],
        notes: conflicting
          ? "The official site contains wording that may exclude high school students. Needs manual review."
          : "The official site excludes high school students.",
        needsReview: conflicting,
      },
      manual: false,
      contentHash: hash,
    };
  }

  if (!page || !page.ok) {
    return {
      eligibility: {
        ...base,
        evidence: directoryEvidence,
        notes: `Official site could not be checked${page?.error ? ` (${page.error})` : ""}.`,
      },
      manual: false,
      contentHash: hash,
    };
  }

  const positives = analysis!.positive.map(toEvidence);
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
        evidence: [...directoryEvidence, ...positives, ...(positives.length ? [] : [{ url: page.url, note: "Official site checked; no restrictions excluding high school students found." }])],
        notes: positives.length ? null : "The official site does not state eligibility in text we could read; listing relies on the high-school-only directory.",
      },
      manual: false,
      contentHash: hash,
    };
  }

  return {
    eligibility: { ...base, notes: "No explicit statement that high school students may participate was found." },
    manual: false,
    contentHash: hash,
  };
}
