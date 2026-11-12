// Who is looking at the map. A visitor without a session is a guest, not an error: the map is public.
import { reactive } from 'vue';
import { api, onSessionExpired } from './client';
import { LOGIN_HOST } from '@/config';

export interface Organization { id: string; name: string; role: string }
export interface User {
  id: string;
  email: string;
  givenName: string | null;
  familyName: string | null;
  jobTitle: string | null;
  phoneNumber: string | null;
  /** given + family name, else the e-mail address */
  name: string;
  organizations: Organization[];
}

interface ApiUserMe {
  id: string; email: string; given_name: string | null; family_name: string | null; job_title: string | null;
  phone_number: string | null; organizations?: Organization[];
}

export const session = reactive<{ ready: boolean; user: User | null }>({ ready: false, user: null });

function fromApi(u: ApiUserMe): User {
  const name = [u.given_name, u.family_name].filter(Boolean).join(' ').trim();
  return {
    id: u.id, email: u.email, givenName: u.given_name, familyName: u.family_name, jobTitle: u.job_title,
    phoneNumber: u.phone_number, name: name || u.email, organizations: u.organizations ?? [],
  };
}

/**
 * Whether this host can hold a login. The cookie belongs to the login host's site (fundermaps.com), so on any other
 * name the browser would not send it: there the map stays a guest's map and the login pages forward to the same page
 * on the login host. Local builds count as yes.
 */
export function onLoginHost(): boolean {
  const host = location.hostname;
  const site = new URL(LOGIN_HOST).hostname.split('.').slice(-2).join('.');
  return host === site || host.endsWith(`.${site}`) || host === 'localhost' || host === '127.0.0.1';
}

let loading: Promise<User | null> | null = null;

/** asks the API once who this is; resolves to the user or null (guest). Never throws. */
export function loadSession(): Promise<User | null> {
  loading ??= (async () => {
    if (onLoginHost()) {
      try { session.user = fromApi(await api<ApiUserMe>('user/me', { quiet401: true, signal: AbortSignal.timeout(8000) })); }
      catch { session.user = null; }
    }
    session.ready = true;
    return session.user;
  })();
  return loading;
}

export async function reloadUser(): Promise<void> {
  session.user = fromApi(await api<ApiUserMe>('user/me'));
}

/** to the login page; it brings the visitor back to `returnTo` once the cookie is set */
export function toLogin(returnTo: string = location.pathname + location.search + location.hash, expired = false): void {
  location.assign(`/login?${expired ? 'expired=1&' : ''}redirect=${encodeURIComponent(returnTo)}`);
}

// a call that needed the session got a 401: it ended elsewhere while the page stayed open
onSessionExpired(() => { if (session.user) toLogin(undefined, true); });
