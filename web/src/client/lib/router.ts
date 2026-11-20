import { useEffect, useSyncExternalStore } from "react";

// Minimal History-API router: the app has five routes, which doesn't justify a dependency.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener("popstate", notify);

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => window.location.pathname + window.location.search;

export function useLocation(): { path: string; search: string } {
  const href = useSyncExternalStore(subscribe, snapshot);
  const i = href.indexOf("?");
  return { path: i === -1 ? href : href.slice(0, i), search: i === -1 ? "" : href.slice(i) };
}

export function navigate(to: string, { replace = false } = {}): void {
  if (to === snapshot()) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", to);
  notify();
}

/** Intercepts plain left-clicks on internal links so they don't reload the page. */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>, to: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(to);
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
