// Where the visitor last looked, kept the way the current map app keeps it: for a user with their account
// (PUT /api/user/metadata, the same keys, so both apps share it), for a guest in this browser.
import { api } from '@/api/client';

export interface Position { lng: number; lat: number; zoom: number; pitch: number; bearing: number }
const KEYS = ['lastCenterPosition', 'lastZoomLevel', 'lastPitchDegree', 'lastRotation'] as const;

function parse(m: Record<string, unknown> | null | undefined): Position | null {
  const c = m?.lastCenterPosition as { lng?: unknown; lat?: unknown } | undefined;
  const lng = Number(c?.lng), lat = Number(c?.lat), zoom = Number(m?.lastZoomLevel);
  // only a place in or around the Netherlands: a stray value must not open the map on the ocean
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < 2.5 || lng > 7.8 || lat < 50.5 || lat > 54) return null;
  const or = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== undefined && v !== '' ? Number(v) : d);
  return { lng, lat, zoom: Number.isFinite(zoom) && zoom >= 5 && zoom <= 22 ? zoom : 15, pitch: or(m?.lastPitchDegree, 58), bearing: or(m?.lastRotation, 0) };
}

/** the API wraps the saved object in one or more { metadata: … } */
function unwrap(v: unknown): Record<string, unknown> | null {
  let m = v as Record<string, unknown> | null;
  for (let i = 0; i < 4 && m && typeof m === 'object' && 'metadata' in m && !('lastCenterPosition' in m); i++) m = m.metadata as Record<string, unknown> | null;
  return m && typeof m === 'object' ? m : null;
}

let saved: Record<string, unknown> = {};

export async function loadPosition(user: boolean): Promise<Position | null> {
  if (user) {
    try { saved = unwrap(await api('user/metadata', { quiet401: true, signal: AbortSignal.timeout(6000) })) ?? {}; return parse(saved); }
    catch { return null; }
  }
  try {
    const m: Record<string, unknown> = {};
    for (const k of KEYS) { const v = localStorage.getItem(k); if (v !== null) m[k] = k === 'lastCenterPosition' ? JSON.parse(v) : v; }
    return parse(m);
  } catch { return null; }
}

let timer = 0;
/** remembers the position half a second after the map came to rest */
export function savePosition(user: boolean, p: Position) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    const m = { lastCenterPosition: { lng: p.lng, lat: p.lat }, lastZoomLevel: String(p.zoom), lastPitchDegree: String(p.pitch), lastRotation: String(p.bearing) };
    if (user) {
      // the other things the account remembers stay as they are
      saved = { ...saved, ...m };
      void api('user/metadata', { method: 'PUT', body: { metadata: saved }, quiet401: true }).catch(() => undefined);
      return;
    }
    try { for (const k of KEYS) localStorage.setItem(k, k === 'lastCenterPosition' ? JSON.stringify(m[k]) : String(m[k])); } catch { /* private mode */ }
  }, 500);
}
