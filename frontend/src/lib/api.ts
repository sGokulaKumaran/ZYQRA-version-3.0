// Thin, typed client for the Zyqra API.

import type { StreamEvent } from "./types";

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://127.0.0.1:8000";

const TOKEN_KEY = "zyqra_token";

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Fired when the server rejects our token, so the app can return to sign-in. */
export const SESSION_EXPIRED = "zyqra:session-expired";

const OFFLINE = "Can't reach the Zyqra server. Check that the backend is running.";

async function send(path: string, init: RequestInit): Promise<Response> {
  const token = tokenStore.get();
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(OFFLINE, 0);
  }

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // keep the generic message
    }
    if (response.status === 401 && token) window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError(message, response.status);
  }
  return response;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: (path: string) => request<void>("DELETE", path),

  /** POST and read the reply as server-sent events, calling `onEvent` for each one. */
  async stream(path: string, body: unknown, onEvent: (event: StreamEvent) => void, signal?: AbortSignal) {
    const response = await send(path, { method: "POST", body: JSON.stringify(body), signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frame.startsWith("data:")) onEvent(JSON.parse(frame.slice(5)) as StreamEvent);
      }
    }
  },
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong.";
