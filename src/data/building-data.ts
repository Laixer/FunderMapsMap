// FunderMaps data for the buildings around the view, from our per-building vector tiles at zoom 14 (Martin: buildings,
// facade_scan, incident, merged per pand in data-worker.ts). Keeps the
// tiles around the view (bounded, farthest dropped first) and offers one flat list + an index by pand number, which the
// map joins to the 3D BAG features. This replaces the prototype's per-city export files: it works for the whole country.
import type { DataReply, Props } from './data-worker';

export type { Props };

/** zoom of the data tiles: from 14 up every building comes with every field (maplayer.buildings) */
const Z = 14;
/** at most this many data tiles in memory (a dense one holds ~3,000 buildings) */
const MAX_TILES = 90;
/** at most this many tiles asked for at once around the view */
const MAX_WANTED = 48;

interface DataTile { key: string; x: number; y: number; state: 'loading' | 'ready' | 'error'; buildings: Props[] }

const tileX = (lon: number) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};

export class BuildingData {
  /** every building of the loaded tiles once (a building on a tile edge sits in both tiles) */
  buildings: Props[] = [];
  index = new Map<string, number>();
  private tiles = new Map<string, DataTile>();
  private workers: Worker[];
  private pending = new Map<number, string>();
  private next = 1;
  private turn = 0;
  private rebuildTimer = 0;

  constructor(private base: string, private onChange: () => void) {
    this.workers = Array.from({ length: 2 }, () => new Worker(new URL('./data-worker.ts', import.meta.url), { type: 'module' }));
    for (const w of this.workers) w.onmessage = (e: MessageEvent<DataReply>) => this.receive(e.data);
  }

  get loading(): number {
    let n = 0;
    for (const t of this.tiles.values()) if (t.state === 'loading') n++;
    return n;
  }

  get ready(): number {
    let n = 0;
    for (const t of this.tiles.values()) if (t.state === 'ready') n++;
    return n;
  }

  /** load the data tiles covering [west, south, east, north] (plus a margin), nearest to the centre first */
  update(bounds: [number, number, number, number], centre: [number, number]) {
    const [w, s, e, n] = bounds;
    const x0 = tileX(w) - 1, x1 = tileX(e) + 1, y0 = tileY(n) - 1, y1 = tileY(s) + 1;
    const cx = tileX(centre[0]), cy = tileY(centre[1]);
    const wanted: { x: number; y: number; d: number }[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) wanted.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    wanted.sort((a, b) => a.d - b.d);
    const keep = new Set<string>();
    for (const t of wanted.slice(0, MAX_WANTED)) {
      const key = `${t.x}/${t.y}`;
      keep.add(key);
      if (!this.tiles.has(key)) this.request(t.x, t.y, key);
    }
    this.evict(keep, cx, cy);
  }

  private request(x: number, y: number, key: string) {
    const id = this.next++;
    this.tiles.set(key, { key, x, y, state: 'loading', buildings: [] });
    this.pending.set(id, key);
    this.workers[this.turn++ % this.workers.length].postMessage({ id, base: this.base, z: Z, x, y });
  }

  private receive(reply: DataReply) {
    const key = this.pending.get(reply.id);
    this.pending.delete(reply.id);
    const tile = key ? this.tiles.get(key) : undefined;
    if (!tile) return;
    if (reply.error) {
      console.error(reply.error);
      tile.state = 'error';
    } else {
      tile.state = 'ready';
      tile.buildings = reply.buildings ?? [];
    }
    this.scheduleRebuild();
  }

  private evict(keep: Set<string>, cx: number, cy: number) {
    if (this.tiles.size <= MAX_TILES) return;
    const spare = [...this.tiles.values()]
      .filter((t) => !keep.has(t.key) && t.state !== 'loading')
      .sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy));
    for (const t of spare.slice(0, this.tiles.size - MAX_TILES)) this.tiles.delete(t.key);
    this.scheduleRebuild();
  }

  /** one rebuild for a burst of arriving tiles */
  private scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = 0;
      this.rebuild();
      this.onChange();
    }, 120);
  }

  private rebuild() {
    const buildings: Props[] = [];
    const index = new Map<string, number>();
    for (const t of this.tiles.values()) {
      for (const b of t.buildings) {
        const id = String(b.id);
        if (index.has(id)) continue;
        index.set(id, buildings.length);
        buildings.push(b);
      }
    }
    this.buildings = buildings;
    this.index = index;
  }
}
