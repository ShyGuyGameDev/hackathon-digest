import type { EventDetail, EventsResponse } from "../../shared/types.ts";

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

export const fetchEvents = () => request<EventsResponse>("/api/events");
export const fetchEvent = (slug: string) => request<{ event: EventDetail; mock: boolean }>(`/api/events/${encodeURIComponent(slug)}`);
export const submitEvent = (payload: Record<string, unknown>) =>
  request<{ ok: true }>("/api/submissions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

export function adminRequest<T>(token: string, path: string, method = "GET", body?: unknown): Promise<T> {
  return request<T>(`/api/admin${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
