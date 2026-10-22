// Mapsets: the API's named collections of layers (application.mapset_collection). Without a login only a public mapset
// can be opened, by id or slug (/map/<slug>): GET /api/mapset/:idOrSlug gives its layer set (names and legends, in its
// own order), note, disclaimer, centre and fence at runtime. The private mapsets of an organisation come with the login.
import { API } from '@/config';
import type { Props } from '@/data/building-data';

export interface MapsetLayer { id: string; name: string; order: number; fields: { name: string; color: string }[] }
export interface Fence { municipality: string[]; district: string[]; neighborhood: string[] }
export interface Mapset {
  id: string;
  name: string;
  slug: string;
  public: boolean;
  /** markdown */
  note: string | null;
  /** markdown; shown before the map until accepted (again after 7 days) */
  consent: string | null;
  /** [lon, lat] */
  center: [number, number] | null;
  layers: MapsetLayer[];
  /** only buildings inside it carry data on this mapset; null = the whole country */
  fence: Fence | null;
}

/**
 * Fences the API does not return for public mapsets: the current map app adds them in the browser too (WebFront
 * store/mapsets.ts, "remove once the API returns the correct fencing values"). Kept the same until that is fixed.
 */
const PUBLIC_FENCES: Record<string, Partial<Fence>> = {
  'schiedam-publiek': { municipality: ['GM0606'] },
  'woerden-publiek': { municipality: ['GM0632'] },
};

/** a public mapset by id or slug; null when there is none (or it is not public) */
export async function loadPublicMapset(idOrSlug: string, signal?: AbortSignal): Promise<Mapset | null> {
  const res = await fetch(`${API}/api/mapset/${encodeURIComponent(idOrSlug)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mapset ${idOrSlug}: ${res.status}`);
  return fromApi(await res.json());
}

function fromApi(raw: any): Mapset {
  const extra = PUBLIC_FENCES[raw.slug] ?? {};
  const fence: Fence = {
    municipality: raw.fence_municipality ?? extra.municipality ?? [],
    district: raw.fence_district ?? extra.district ?? [],
    neighborhood: raw.fence_neighborhood ?? extra.neighborhood ?? [],
  };
  const center = raw.metadata?.center;
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    public: raw.public === true,
    note: raw.note || null,
    consent: raw.consent || null,
    center: Array.isArray(center) && center.length === 2 ? [Number(center[0]), Number(center[1])] : null,
    layers: [...(raw.layerset ?? [])]
      .map((l: any) => ({ id: l.id, name: l.name ?? l.id, order: Number(l.order ?? 0), fields: l.fields ?? [] }))
      .sort((a, b) => a.order - b.order),
    fence: fence.municipality.length || fence.district.length || fence.neighborhood.length ? fence : null,
  };
}

const LEVELS = [['municipality', 'municipality_id'], ['district', 'district_id'], ['neighborhood', 'neighborhood_id']] as const;

/**
 * Inside the fence, as the current map app filters (useGeographyFilter.ts): a building is in when, at any fenced level,
 * its area is listed or it has no such field (a building merged in from the facade-scan or incident tiles only).
 */
export function fenceTest(fence: Fence | null): ((p: Props) => boolean) | null {
  if (!fence) return null;
  const levels = LEVELS.filter(([level]) => fence[level].length).map(([level, prop]) => ({ prop, ids: new Set(fence[level]) }));
  return (p) => levels.some(({ prop, ids }) => p[prop] === undefined || ids.has(String(p[prop])));
}

/** the same test as a MapLibre filter expression, for flat mode */
export function fenceExpression(fence: Fence | null): unknown[] | null {
  if (!fence) return null;
  const parts = LEVELS.filter(([level]) => fence[level].length).map(([level, prop]) =>
    ['any', ['!', ['has', prop]], ['in', ['get', prop], ['literal', fence[level]]]]);
  return ['any', ...parts];
}
