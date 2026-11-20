# Curated events

Reviewer-researched events. Every `*.json` file in this folder is an array of entries, and ingestion loads all of them. These
entries outrank automated sources when the data conflicts.

Only record what an official page states. Leave unknown fields out; never guess.

`eligibility` is optional. Leave it out when you haven't checked the rules yourself, and the event goes through the automated
check like any other.

Ingestion rejects the whole file with an error if:

- `eligibility.status` is `verified` without at least one `evidence` item that has both `url` and `quote`
- `eligibility.checkedAt` is missing
- `submissionDeadlineVerified` is `true` without `submissionDeadlineSource`

Example entry. It's fictional and kept here for reference only, never inside a `.json` file:

```json
{
  "externalId": "example-hacks-2027",
  "name": "Example Hacks 2027",
  "organizer": "Example High School CS Club",
  "summary": "A 24-hour hackathon for high school students in Austin.",
  "websiteUrl": "https://example.org/",
  "registrationUrl": "https://example.org/register",
  "rulesUrl": "https://example.org/rules",
  "startAt": "2027-02-20T15:00:00Z",
  "endAt": "2027-02-21T15:00:00Z",
  "timezone": "America/Chicago",
  "submissionDeadlineAt": "2027-02-21T14:00:00Z",
  "submissionDeadlineVerified": true,
  "submissionDeadlineSource": "https://example.org/rules",
  "format": "in_person",
  "city": "Austin", "state": "Texas", "country": "United States", "countryCode": "US",
  "teamMin": 1, "teamMax": 4, "soloAllowed": true,
  "categories": ["ai", "social_impact"],
  "perks": ["beginner_friendly", "cash_prizes"],
  "cost": "free",
  "prizeSummary": "$3,000 in prizes",
  "eligibility": {
    "status": "verified",
    "highSchoolAllowed": true,
    "educationLevels": ["high_school"],
    "minAge": 13, "maxAge": 18, "grades": [9, 10, 11, 12],
    "geographicRestrictions": null,
    "internationalAllowed": null,
    "requiresCollegeEnrollment": false,
    "evidence": [{ "url": "https://example.org/rules", "quote": "Open to all high school students aged 13–18." }],
    "sourceUrl": "https://example.org/rules",
    "checkedAt": "2026-11-19T00:00:00Z",
    "notes": null
  }
}
```

Allowed values: `format` is `online`, `in_person` or `hybrid`. For `categories`, `perks` and `educationLevels`, see
`src/shared/taxonomy.ts`. Unknown values are dropped.
