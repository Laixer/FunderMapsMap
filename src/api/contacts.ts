// Who a logged-in user can turn to: the account holder of their organisation (set per organisation in the Studio's
// Beheer, sent along with /api/user/me), or the general address when none is set.
import type { User } from './session';
import { CONTACT_EMAIL } from '@/config';

export interface Contact {
  /** false: the general address, no person */
  person: boolean;
  name: string;
  jobTitle: string | null;
  email: string;
  phone: { href: string; label: string } | null;
  /** an https address of a photo, else null (initials are shown) */
  picture: string | null;
  /** the organisations this contact is for; only filled when the user has more than one contact */
  organizations: string[];
}

/**
 * A stored phone number (digits only, an international one starts with 00) as a link and as text. Only what is certain
 * is spaced: the country code, and the 6 of a Dutch mobile number.
 */
export function phoneLink(digits: string | null): Contact['phone'] {
  const d = (digits ?? '').replace(/\D/g, '');
  if (d.length < 8) return null;
  if (d.startsWith('0031')) {
    const rest = d.slice(4);
    return { href: `tel:+31${rest}`, label: rest.startsWith('6') ? `+31 6 ${rest.slice(1)}` : `+31 ${rest}` };
  }
  if (d.startsWith('00')) return { href: `tel:+${d.slice(2)}`, label: `+${d.slice(2)}` };
  return { href: `tel:${d}`, label: d.startsWith('06') && d.length === 10 ? `06 ${d.slice(2)}` : d };
}

/**
 * The contacts of a user, one per person. The map has no "organisation you are working in", so someone in several
 * organisations with different account holders sees each, with the organisation it is for.
 */
export function contactsOf(user: User): Contact[] {
  const general: Contact = { person: false, name: 'FunderMaps', jobTitle: null, email: CONTACT_EMAIL, phone: null, picture: null, organizations: [] };
  const byKey = new Map<string, Contact>();
  for (const o of user.organizations) {
    const h = o.accountHolder;
    const key = h ? h.email.toLowerCase() : '';
    let c = byKey.get(key);
    if (!c) {
      c = h
        ? { person: true, name: h.name || h.email, jobTitle: h.jobTitle, email: h.email, phone: phoneLink(h.phoneNumber),
            picture: h.picture && /^https:\/\//.test(h.picture) ? h.picture : null, organizations: [] }
        : { ...general, organizations: [] };
      byKey.set(key, c);
    }
    c.organizations.push(o.name);
  }
  const list = [...byKey.values()];
  if (!list.length) return [general];
  if (list.length === 1) list[0]!.organizations = [];
  // people first, the general address last
  return list.sort((a, b) => Number(b.person) - Number(a.person));
}
