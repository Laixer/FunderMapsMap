// Web Worker: for one zoom-14 tile, fetches our three per-building vector tile sources (Martin) and returns one property
// object per building, keyed by the 16-digit BAG pand number:
//   buildings    every building with every field of the model (building_id)
//   facade_scan  the latest facade scan of a building (external_id): risk, facade_scan_risk, facade_type, skewed_*, …
//   incident     buildings with a melding (id): adds incident = true
// The geometry is not decoded: the shapes come from the 3D tiles. Running here keeps the decode off the main thread.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

export type Props = Record<string, string | number | boolean>;
export interface DataRequest { id: number; base: string; z: number; x: number; y: number }
export interface DataReply { id: number; buildings?: Props[]; error?: string }

const scope = self as unknown as { onmessage: ((e: MessageEvent<DataRequest>) => void) | null; postMessage: (msg: DataReply) => void };

/** facade scan fields taken over onto the building (the rest: ids and height, the building has its own) */
const FACADE = ['risk', 'facade_scan_risk', 'facade_type', 'skewed_parallel_facade', 'skewed_perpendicular_facade', 'settlement_speed', 'priority'];

async function layer(url: string, name: string): Promise<Props[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) return [];
  const l = new VectorTile(new Pbf(bytes)).layers[name];
  const out: Props[] = [];
  for (let i = 0; l && i < l.length; i++) out.push(l.feature(i).properties as Props);
  return out;
}

scope.onmessage = async (e) => {
  const { id, base, z, x, y } = e.data;
  try {
    const at = (source: string) => `${base}/${source}/${z}/${x}/${y}`;
    const [buildings, facades, incidents] = await Promise.all([
      layer(at('buildings'), 'buildings'),
      layer(at('facade_scan'), 'facade_scan'),
      layer(at('incident'), 'incident'),
    ]);
    const byId = new Map<string, Props>();
    for (const p of buildings) {
      const full = String(p.building_id ?? '');
      if (!full) continue;
      p.id = full.slice(-16);
      byId.set(p.id, p);
    }
    const get = (full: unknown): Props | null => {
      const key = String(full ?? '').slice(-16);
      if (!key) return null;
      let p = byId.get(key);
      if (!p) { p = { id: key, building_id: String(full) }; byId.set(key, p); }
      return p;
    };
    for (const f of facades) {
      const p = get(f.external_id);
      if (p) for (const k of FACADE) if (f[k] !== undefined) p[k] = f[k];
    }
    for (const f of incidents) {
      const p = get(f.id);
      if (p) p.incident = true;
    }
    scope.postMessage({ id, buildings: [...byId.values()] });
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
