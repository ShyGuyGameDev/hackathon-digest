import { memo } from "react";
import { dateBadge, deadlineLabel, formatRange } from "../../shared/dates.ts";
import { CATEGORIES, labelFor } from "../../shared/taxonomy.ts";
import type { EventSummary } from "../../shared/types.ts";
import { onLinkClick } from "../lib/router.ts";
import { countryName } from "./FilterPanel.tsx";
import { StarIcon } from "./Icons.tsx";

export const FORMAT_LABEL = { online: "Online", in_person: "In person", hybrid: "Hybrid" } as const;

export function placeLabel(e: Pick<EventSummary, "format" | "city" | "state" | "country" | "countryCode">): string | null {
  if (e.format === "online") return null;
  const country = e.countryCode ? countryName(e.countryCode) : e.country;
  if (e.countryCode === "US") return [e.city, e.state].filter(Boolean).join(", ") || country;
  return [e.city, country].filter(Boolean).join(", ") || null;
}

export function DeadlinePill({ e, now }: { e: EventSummary; now: Date }) {
  const d = deadlineLabel(e, now);
  return (
    <span className={`deadline ${d.tone}`} title={d.tone === "muted" ? "The official submission deadline hasn't been verified" : undefined}>
      {d.tone === "urgent" && <span className="dot" aria-hidden="true" />}
      {d.text}
    </span>
  );
}

/** Which date the left column shows; follows the sort order (see DATE_COLUMN in DiscoverPage). */
export type DateColumn = "start" | "end" | "listed";

interface Props {
  dateColumn: DateColumn;
  event: EventSummary;
  now: Date;
  selected: boolean;
  saved: boolean;
  href: string;
  onToggleSave: (id: string) => void;
}

export const EventRow = memo(function EventRow({ event: e, dateColumn, now, selected, saved, href, onToggleSave }: Props) {
  // "Listed" is when we first saw the event, so it's shown in the viewer's zone rather than the event's.
  const badge =
    dateColumn === "listed"
      ? dateBadge(e.firstSeenAt, null)
      : dateBadge(dateColumn === "end" ? (e.endAt ?? e.startAt) : e.startAt, e.timezone);
  const place = placeLabel(e);
  const tags = e.categories.slice(0, 2).map((c) => labelFor(CATEGORIES, c));
  const where = [FORMAT_LABEL[e.format], place].filter(Boolean).join(" · ");
  return (
    <div className="row" role="listitem" aria-current={selected ? "true" : undefined}>
      <div className="date" aria-hidden="true">
        {badge ? (
          <>
            <div className="m">{badge.month}</div>
            <div className="d">{badge.day}</div>
            <div className="w">{badge.weekday}</div>
          </>
        ) : (
          <div className="w">TBA</div>
        )}
      </div>
      <div className="main">
        <div className="title">
          <a className="stretched" href={href} onClick={(ev) => onLinkClick(ev, href)}>{e.name}</a>
          {e.organizer && <span className="org">{e.organizer}</span>}
        </div>
        <span className="visually-hidden">{formatRange(e.startAt, e.endAt, e.timezone, now)}. </span>
        {e.summary && <div className="summary">{e.summary}</div>}
        <div className="meta-inline">{[formatRange(e.startAt, e.endAt, e.timezone, now), where].join(" · ")}</div>
      </div>
      <div className="where">
        <div className="fmt">{FORMAT_LABEL[e.format]} <span className="loc">· {formatRange(e.startAt, e.endAt, e.timezone, now)}</span></div>
        <div className="loc">{place ?? (tags.length ? tags.join(", ") : e.prizeSummary ?? " ")}</div>
        {place && (tags.length > 0 || e.prizeSummary) && <div className="tags">{tags.length ? tags.join(", ") : e.prizeSummary}</div>}
      </div>
      <div className="right">
        <DeadlinePill e={e} now={now} />
        <button
          type="button"
          className="icon-btn"
          aria-pressed={saved}
          aria-label={saved ? `Remove ${e.name} from saved` : `Save ${e.name}`}
          title={saved ? "Saved" : "Save"}
          onClick={() => onToggleSave(e.id)}
        >
          <StarIcon filled={saved} />
        </button>
      </div>
    </div>
  );
});
