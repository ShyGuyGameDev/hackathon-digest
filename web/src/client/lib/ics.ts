import type { EventDetail } from "../../shared/types.ts";

const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);

// RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + space.
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
    }
    cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** RFC 5545 calendar with the event itself and, when verified, the submission deadline. */
export function buildIcs(e: EventDetail, pageUrl: string): string | null {
  if (!e.startAt) return null;
  const now = stamp(new Date().toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hackathon Digest//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const location = e.format === "online" ? "Online" : [e.venue, e.city, e.state, e.country].filter(Boolean).join(", ");
  lines.push(
    "BEGIN:VEVENT", `UID:${e.id}@hackathon-digest`, `DTSTAMP:${now}`, `DTSTART:${stamp(e.startAt)}`,
    `DTEND:${stamp(e.endAt ?? e.startAt)}`, `SUMMARY:${escape(e.name)}`, `URL:${pageUrl}`,
    `DESCRIPTION:${escape(`${e.summary ?? ""}\n\nDetails: ${pageUrl}\nOfficial site: ${e.websiteUrl ?? "n/a"}`)}`,
    ...(location ? [`LOCATION:${escape(location)}`] : []), "END:VEVENT",
  );
  if (e.submissionDeadlineStatus === "verified" && e.submissionDeadlineAt) {
    lines.push(
      "BEGIN:VEVENT", `UID:${e.id}-deadline@hackathon-digest`, `DTSTAMP:${now}`, `DTSTART:${stamp(e.submissionDeadlineAt)}`,
      `DTEND:${stamp(e.submissionDeadlineAt)}`, `SUMMARY:${escape(`Submissions close: ${e.name}`)}`, `URL:${pageUrl}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escape(`${e.name} submissions close in 1 day`)}`, "TRIGGER:-P1D", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadFile(name: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
