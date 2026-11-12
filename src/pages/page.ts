// The pages of the app by address, the same addresses as the current map app's.
export type Page = 'map' | 'login' | 'forgot-password' | 'reset-password' | 'account' | 'old-reset' | 'not-found';

export function pageOf(pathname: string): Page {
  const parts = pathname.split('/').filter(Boolean);
  const first = parts[0] ?? '';
  if (!first || first === 'map' || first === 'kaart') return 'map';
  if (parts.length === 1 && (first === 'login' || first === 'forgot-password' || first === 'reset-password' || first === 'account')) return first;
  // /forgotten and /reset/<key>: the forgot-password page's old addresses
  if ((first === 'forgotten' && parts.length === 1) || (first === 'reset' && parts.length <= 2)) return 'old-reset';
  return 'not-found';
}
