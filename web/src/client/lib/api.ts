import type { EventDetail, EventsResponse } from "../../shared/types.ts";
import { fetchEventFromSupabase, fetchEventsFromSupabase, submitToSupabase, supabaseEnabled } from "./supabase.ts";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

// With Supabase configured (production on Vercel) the browser reads the database directly;
// otherwise it talks to the local Node server (development, self-hosting).
export const fetchEvents = () => (supabaseEnabled ? fetchEventsFromSupabase() : request<EventsResponse>("/api/events"));
export const fetchEvent = (slug: string) =>
  supabaseEnabled
    ? fetchEventFromSupabase(slug).catch((err: Error & { status?: number }) => {
        throw new ApiError(err.status ?? 500, err.message);
      })
    : request<{ event: EventDetail; mock: boolean }>(`/api/events/${encodeURIComponent(slug)}`);
export const submitEvent = (payload: Record<string, unknown>) =>
  supabaseEnabled
    ? submitToSupabase(payload)
    : request<{ ok: true }>("/api/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

/** The admin dashboard needs the Node server; it isn't available on the Supabase deployment. */
export const adminAvailable = !supabaseEnabled;

export function adminRequest<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  return request<T>(`/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
