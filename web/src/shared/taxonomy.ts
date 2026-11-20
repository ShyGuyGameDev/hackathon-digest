import type { Cost, EducationLevel, Format, Perk } from "./types.ts";

export const FORMATS: { id: Format; label: string }[] = [
  { id: "online", label: "Online" },
  { id: "in_person", label: "In person" },
  { id: "hybrid", label: "Hybrid" },
];

export const CATEGORIES: { id: string; label: string }[] = [
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
  { id: "open", label: "Open innovation" },
];

export const PERKS: { id: Perk; label: string }[] = [
  { id: "beginner_friendly", label: "Beginner friendly" },
  { id: "cash_prizes", label: "Cash prizes" },
  { id: "scholarships", label: "Scholarships" },
  { id: "internships", label: "Internship opportunities" },
  { id: "hardware_prizes", label: "Hardware prizes" },
  { id: "travel_assistance", label: "Travel assistance" },
  { id: "accommodation", label: "Accommodation" },
];

export const COSTS: { id: Cost; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "paid", label: "Paid entry" },
];

export const EDUCATION_LEVELS: { id: EducationLevel; label: string }[] = [
  { id: "middle_school", label: "Middle school" },
  { id: "high_school", label: "High school" },
  { id: "undergraduate", label: "Undergraduate" },
  { id: "graduate", label: "Graduate" },
  { id: "anyone", label: "Anyone" },
];

export const GRADES = [9, 10, 11, 12];

export const REGIONS: { id: string; label: string }[] = [
  { id: "north_america", label: "North America" },
  { id: "latin_america", label: "Latin America & Caribbean" },
  { id: "europe", label: "Europe" },
  { id: "middle_east_africa", label: "Middle East & Africa" },
  { id: "south_asia", label: "South Asia" },
  { id: "east_asia", label: "East Asia" },
  { id: "southeast_asia", label: "Southeast Asia" },
  { id: "oceania", label: "Oceania" },
];

// ISO 3166-1 alpha-2 → region. Grouped for readability.
const REGION_CODES: Record<string, string> = {
  north_america: "US CA BM GL PM",
  latin_america:
    "MX GT BZ SV HN NI CR PA CU DO HT JM BS BB TT AG DM GD KN LC VC PR VI VG AI AW CW SX BQ KY TC MS GP MQ BL MF CO VE EC PE BO PY UY AR CL BR GY SR GF FK",
  europe:
    "GB IE FR DE NL BE LU CH AT IT ES PT AD MC SM VA MT DK NO SE FI IS EE LV LT PL CZ SK HU SI HR BA RS ME MK AL GR BG RO MD UA BY RU XK CY LI FO GI IM JE GG AX",
  middle_east_africa:
    "TR IL PS JO LB SY IQ IR SA AE QA BH KW OM YE EG LY TN DZ MA EH SD SS ET ER DJ SO KE UG RW BI TZ MZ MW ZM ZW BW NA ZA LS SZ AO CD CG GA GQ CM CF TD NE NG BJ TG GH CI LR SL GN GW SN GM ML BF MR CV ST MG MU SC KM RE YT",
  south_asia: "IN PK BD LK NP BT MV AF",
  east_asia: "CN JP KR KP TW HK MO MN",
  southeast_asia: "SG MY ID TH VN PH KH LA MM BN TL",
  oceania: "AU NZ FJ PG SB VU WS TO KI TV NR PW FM MH NC PF CK NU",
};

const COUNTRY_TO_REGION = new Map<string, string>();
for (const [region, codes] of Object.entries(REGION_CODES)) {
  for (const code of codes.split(" ")) COUNTRY_TO_REGION.set(code, region);
}

/** Human-readable names for record origins (event_sources.source). */
export const SOURCE_LABELS: Record<string, string> = {
  curated: "Reviewer-curated events",
  hackclub: "Hack Club Hackathons directory",
  submission: "Organizer submission (reviewed)",
  digest: "Featured in the Hackathon Digest email",
  research: "Found by daily research",
};

export function regionForCountry(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return COUNTRY_TO_REGION.get(countryCode.toUpperCase()) ?? null;
}

export function labelFor(list: { id: string; label: string }[], id: string): string {
  return list.find((item) => item.id === id)?.label ?? id;
}
