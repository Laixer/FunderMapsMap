// Calls to the FunderMaps API with the login cookie. The session is the API's cookie; nothing of it is kept here.
import { API } from '@/config';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`API ${status}`);
  }
}

/** called when the API says the session is gone on a call that needed one (the app sends the visitor to the login) */
let onExpired: (() => void) | null = null;
export function onSessionExpired(fn: () => void) { onExpired = fn; }

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** a 401 is an answer, not the end of the session (the first "who am I") */
  quiet401?: boolean;
}

/** GET (or method) /api/<path> with the cookie; JSON in and out. Throws ApiError on any answer that is not OK. */
export async function api<T>(path: string, { method = 'GET', body, signal, quiet401 = false }: Options = {}): Promise<T> {
  const res = await fetch(`${API}/api/${path}`, {
    method, signal, credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: unknown = null;
  if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
  if (!res.ok) {
    if (res.status === 401 && !quiet401) onExpired?.();
    throw new ApiError(res.status, payload);
  }
  return payload as T;
}
