// Web Worker: fetches one of our `buildings` vector tiles (Martin, zoom 14: every building with all its fields) and
// returns only the properties, keyed by the 16-digit BAG pand number. The geometry is not decoded: the shapes come from
// 3D BAG. Running here keeps the decode (up to a few thousand buildings per tile) off the main thread.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

export type Props = Record<string, string | number | boolean>;
export interface DataRequest { id: number; url: string }
export interface DataReply { id: number; buildings?: Props[]; error?: string }

const scope = self as unknown as { onmessage: ((e: MessageEvent<DataRequest>) => void) | null; postMessage: (msg: DataReply) => void };

scope.onmessage = async (e) => {
  const { id, url } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const buildings: Props[] = [];
    if (bytes.length) {
      const layer = new VectorTile(new Pbf(bytes)).layers.buildings;
      for (let i = 0; layer && i < layer.length; i++) {
        const p = layer.feature(i).properties as Props;
        const full = String(p.building_id ?? '');
        if (!full) continue;
        p.id = full.slice(-16);
        buildings.push(p);
      }
    }
    scope.postMessage({ id, buildings });
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
