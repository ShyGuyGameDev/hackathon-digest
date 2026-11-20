import { useCallback, useMemo, useSyncExternalStore } from "react";

// Per-browser conveniences only (saved events, recently viewed). Storage can be unavailable
// (private mode, blocked cookies), so every access is guarded and the app works without it.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep the in-memory value */
  }
}

function createStore<T>(key: string, fallback: T) {
  let value = read(key, fallback);
  const listeners = new Set<() => void>();
  window.addEventListener("storage", (e) => {
    if (e.key === key) {
      value = read(key, fallback);
      listeners.forEach((l) => l());
    }
  });
  return {
    get: () => value,
    set(next: T) {
      value = next;
      write(key, next);
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const savedStore = createStore<string[]>("hd.saved", []);
const recentStore = createStore<string[]>("hd.recent", []);

export function useSaved(): { saved: ReadonlySet<string>; toggle: (id: string) => void } {
  const list = useSyncExternalStore(savedStore.subscribe, savedStore.get);
  const toggle = useCallback((id: string) => {
    const cur = savedStore.get();
    savedStore.set(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }, []);
  const saved = useMemo(() => new Set(list), [list]);
  return { saved, toggle };
}

export function useRecent(): string[] {
  return useSyncExternalStore(recentStore.subscribe, recentStore.get);
}

export function rememberViewed(slug: string): void {
  recentStore.set([slug, ...recentStore.get().filter((s) => s !== slug)].slice(0, 6));
}
