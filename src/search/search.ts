// Address search for the whole country: PDOK Locatieserver suggestions (near the view), then our public building
// lookup turns the chosen address into its pand and a point. No login needed for either.
import { API, PDOK } from '@/config';

export interface Suggestion { id: string; label: string; sub: string }
export interface Place { buildingId: string; lon: number; lat: number; label: string }

interface PdokDoc { id: string; type: string; weergavenaam: string; nummeraanduiding_id?: string; centroide_ll?: string }

const TYPES = 'type:(woonplaats OR postcode OR adres)';
const TYPE_LABEL: Record<string, string> = { adres: 'Adres', postcode: 'Postcode', woonplaats: 'Plaats' };

export async function suggest(query: string, near?: { lon: number; lat: number }, signal?: AbortSignal): Promise<Suggestion[]> {
  const where = near ? `&lat=${near.lat.toFixed(5)}&lon=${near.lon.toFixed(5)}` : '';
  const res = await fetch(`${PDOK}/suggest?q=${encodeURIComponent(query)}&rows=8&fq=${encodeURIComponent(TYPES)}${where}`, { signal });
  if (!res.ok) return [];
  const docs: PdokDoc[] = (await res.json()).response?.docs ?? [];
  return docs.map((d) => ({ id: d.id, label: d.weergavenaam, sub: TYPE_LABEL[d.type] ?? d.type }));
}

/** a PDOK id → where to go; for an address also the pand to select */
export async function resolve(id: string): Promise<{ lon: number; lat: number; zoom: number; buildingId?: string } | null> {
  const res = await fetch(`${PDOK}/lookup?id=${encodeURIComponent(id)}&fl=id,type,weergavenaam,centroide_ll,nummeraanduiding_id`);
  if (!res.ok) return null;
  const doc: PdokDoc | undefined = (await res.json()).response?.docs?.[0];
  if (!doc?.centroide_ll) return null;
  const m = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(doc.centroide_ll);
  if (!m) return null;
  const point = { lon: Number(m[1]), lat: Number(m[2]) };
  if (doc.type !== 'adres' || !doc.nummeraanduiding_id) return { ...point, zoom: doc.type === 'postcode' ? 17 : 14.5 };
  const info = await buildingInfo(`NL.IMBAG.NUMMERAANDUIDING.${doc.nummeraanduiding_id}`);
  return { ...point, zoom: 17.4, buildingId: info?.building_id?.slice(-16) };
}

export interface BuildingInfo {
  building_id: string;
  street?: string | null;
  building_number?: string | null;
  postal_code?: string | null;
  city?: string | null;
  neighborhood_name?: string | null;
  district_name?: string | null;
  municipality_name?: string | null;
  state_name?: string | null;
  building_lon?: number;
  building_lat?: number;
}

/** our public geocoder: a pand, address or gfm id → address, buurt, wijk, gemeente, provincie */
export async function buildingInfo(id: string, signal?: AbortSignal): Promise<BuildingInfo | null> {
  try {
    const res = await fetch(`${API}/api/geocoder/building-info/${encodeURIComponent(id)}`, { signal });
    return res.ok ? ((await res.json()) as BuildingInfo) : null;
  } catch {
    return null;
  }
}
