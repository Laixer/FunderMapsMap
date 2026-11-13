// The login itself: the API's Better Auth endpoints (/api/auth/*), as the current map app calls them. Every message a
// visitor sees is one of our own Dutch texts, never what the server sent (that is English, or an edge's HTML page).
import { API } from '@/config';

export const RESET_LINK_EXPIRED = 'Deze resetlink is ongeldig of verlopen. Vraag een nieuwe aan.';
export const NO_CONNECTION = 'Geen verbinding met FunderMaps. Probeer het opnieuw.';
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Onjuist e-mailadres of wachtwoord.',
  INVALID_EMAIL: 'Vul een geldig e-mailadres in.',
  INVALID_TOKEN: RESET_LINK_EXPIRED,
  INVALID_PASSWORD: 'Het huidige wachtwoord klopt niet.',
  PASSWORD_TOO_SHORT: 'Het wachtwoord is te kort. Gebruik minimaal 8 tekens.',
  PASSWORD_TOO_LONG: 'Het wachtwoord is te lang.',
};

export function failureMessage(status: number, code: unknown): string {
  return (typeof code === 'string' && MESSAGES[code])
    || (status === 429 && 'Te veel pogingen. Wacht even en probeer het opnieuw.')
    || 'Er ging iets mis. Probeer het later opnieuw.';
}

/** POST (or GET) /api/auth<path>. Throws an Error whose message can be shown as it is. */
async function call<T = unknown>(path: string, body?: Record<string, unknown>, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  let res: Response;
  let text: string;
  try {
    // A POST always carries a JSON body, an empty one where there is nothing to say (sign-out): the API refuses a POST
    // without one (415), and the visitor would stay logged in.
    const post = method === 'POST';
    res = await fetch(`${API}/api/auth${path}`, {
      method, credentials: 'include',
      headers: post ? { 'Content-Type': 'application/json' } : undefined,
      body: post ? JSON.stringify(body ?? {}) : undefined,
    });
    text = await res.text();
  } catch {
    throw new Error(NO_CONNECTION);
  }
  let payload: unknown = null;
  if (text) { try { payload = JSON.parse(text); } catch { payload = text; } }
  if (!res.ok) throw new Error(failureMessage(res.status, (payload as { code?: unknown } | null)?.code));
  return payload as T;
}

export interface SessionUser { id: string; email: string; name?: string | null }

export const login = (email: string, password: string) => call('/sign-in/email', { email, password }).then(() => undefined);

export async function getSession(): Promise<{ user: SessionUser } | null> {
  try {
    const res = await call<{ user?: SessionUser } | null>('/get-session', undefined, 'GET');
    return res?.user ? { user: res.user } : null;
  } catch {
    return null;
  }
}

/** ends the session at the API, which clears the cookie; false when that did not work (still logged in) */
export async function signOut(): Promise<boolean> {
  try { await call('/sign-out'); return true; } catch { return false; }
}

/** `redirectTo` must be an origin the API trusts; the mail's link comes back here with ?token= */
export const requestPasswordReset = (email: string) =>
  call('/request-password-reset', { email, redirectTo: `${location.origin}/reset-password` }).then(() => undefined);

export const resetPassword = (token: string, newPassword: string) => call('/reset-password', { token, newPassword }).then(() => undefined);

export const changePassword = (currentPassword: string, newPassword: string) =>
  call('/change-password', { currentPassword, newPassword }).then(() => undefined);

/**
 * Where a login may send the visitor on: this map, or another FunderMaps app. The login page must not be usable as an
 * open redirector.
 */
export function safeRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, location.origin);
    const own = url.origin === location.origin;
    const fundermaps = url.protocol === 'https:' && /(^|\.)fundermaps\.com$/.test(url.hostname);
    return own || fundermaps ? url.toString() : null;
  } catch {
    return null;
  }
}

// ---- passkeys: the only part that needs Better Auth's own client (WebAuthn ceremony), loaded when first used ----
export interface Passkey { id: string; name?: string | null; deviceType: string; backedUp: boolean; createdAt?: string | Date | null }

/** the API wants a (new) login first: the session ended elsewhere (401) or is too old to add a passkey */
export class SessionExpiredError extends Error {}

async function client() {
  const [{ createAuthClient }, { passkeyClient }] = await Promise.all([import('better-auth/client'), import('@better-auth/passkey/client')]);
  return createAuthClient({ baseURL: API, basePath: '/api/auth', fetchOptions: { credentials: 'include' }, plugins: [passkeyClient()] });
}
let shared: ReturnType<typeof client> | null = null;
const authClient = () => (shared ??= client());

export const passkeysSupported = () => typeof window.PublicKeyCredential !== 'undefined';

/** true when signed in; false when the visitor dismissed the browser's prompt (not an error) */
export async function loginWithPasskey(opts: { autoFill?: boolean } = {}): Promise<boolean> {
  const c = await authClient();
  const res = await c.signIn.passkey(opts).catch(() => { throw new Error(NO_CONNECTION); });
  if (res?.error) {
    if (res.error.status === 0 || /abort|cancel|NotAllowed/i.test(res.error.message ?? '')) return false;
    throw new Error(failureMessage(res.error.status, (res.error as { code?: unknown }).code));
  }
  return !!res?.data;
}

function passkeyFailure(error: { status?: number; code?: string; message?: string }, fallback: string): Error {
  if (error.status === 401 || error.code === 'SESSION_NOT_FRESH') return new SessionExpiredError(fallback);
  return new Error(error.message ?? fallback);
}

export async function listPasskeys(): Promise<Passkey[]> {
  const res = await (await authClient()).passkey.listUserPasskeys();
  if (res.error) throw passkeyFailure(res.error, 'Passkeys ophalen mislukt');
  return (res.data ?? []) as Passkey[];
}

export async function addPasskey(name: string): Promise<void> {
  const res = await (await authClient()).passkey.addPasskey({ name });
  if (res?.error) throw passkeyFailure(res.error, 'Passkey toevoegen mislukt');
}

export async function deletePasskey(id: string): Promise<void> {
  const res = await (await authClient()).passkey.deletePasskey({ id });
  if (res.error) throw passkeyFailure(res.error, 'Passkey verwijderen mislukt');
}
