// The trees of the Netherlands as points, straight from the BGT (Basisregistratie Grootschalige Topografie, PDOK, open
// data, CC0): every tree a municipality or other source holder has registered. Fetched per map cell around the view and
// kept while it is near. The BGT says where a tree stands, not how tall it is or what kind it is.
import { BGT } from '@/config';

/** web-mercator zoom of the cells the trees are asked for in (about 600 m across here) */
const Z = 16;
/** at most this many cells are asked for per view, the nearest first, and this many are kept */
const MAX_WANTED = 20;
const MAX_KEPT = 60;
/** a cell of a park can hold thousands of trees: the service gives 1000 per page */
const MAX_PAGES = 6;

const tileX = (lon: number) => ((lon + 180) / 360) * 2 ** Z;
const tileY = (lat: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** Z;
const lonOf = (x: number) => (x / 2 ** Z) * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;

interface Cell { key: string; x: number; y: number; state: 'loading' | 'ready' | 'error'; abort: AbortController; n: number }

export class TreeData {
  private cells = new Map<string, Cell>();
  loading = 0;
  /** trees in the cells that are loaded now */
  count = 0;

  /** onCell(key, lon/lat pairs) when a cell arrives; onCell(key, null) when it is dropped */
  constructor(private onCell: (key: string, lonLat: Float64Array | null) => void) {}

  /** ask for the cells that touch [west, south, east, north], the nearest to the centre first */
  update(view: [number, number, number, number], centre: [number, number]) {
    const x0 = Math.floor(tileX(view[0])), x1 = Math.floor(tileX(view[2]));
    const y0 = Math.floor(tileY(view[3])), y1 = Math.floor(tileY(view[1]));
    const cx = tileX(centre[0]), cy = tileY(centre[1]);
    const wanted: { x: number; y: number; d: number }[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) wanted.push({ x, y, d: Math.hypot(x + 0.5 - cx, y + 0.5 - cy) });
    wanted.sort((a, b) => a.d - b.d);
    const keep = new Set<string>();
    for (const t of wanted.slice(0, MAX_WANTED)) {
      const key = `${t.x}/${t.y}`;
      keep.add(key);
      if (!this.cells.has(key)) void this.load(key, t.x, t.y);
    }
    if (this.cells.size > MAX_KEPT) {
      const spare = [...this.cells.values()].filter((c) => !keep.has(c.key)).sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy));
      for (const c of spare.slice(0, this.cells.size - MAX_KEPT)) this.drop(c);
    }
  }

  /** forget everything (the trees were switched off) */
  clear() {
    for (const c of [...this.cells.values()]) this.drop(c);
  }

  private drop(c: Cell) {
    c.abort.abort();
    this.count -= c.n;
    this.cells.delete(c.key);
    this.onCell(c.key, null);
  }

  private async load(key: string, x: number, y: number) {
    const cell: Cell = { key, x, y, state: 'loading', abort: new AbortController(), n: 0 };
    this.cells.set(key, cell);
    this.loading++;
    try {
      const bbox = [lonOf(x), latOf(y + 1), lonOf(x + 1), latOf(y)].map((v) => v.toFixed(6)).join(',');
      let url: string | null = `${BGT}/collections/vegetatieobject_punt/items?bbox=${bbox}&limit=1000&f=json`;
      const out: number[] = [];
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const res: Response = await fetch(url, { signal: cell.abort.signal });
        if (!res.ok) throw new Error(`BGT ${res.status}`);
        const json = await res.json();
        for (const f of json.features ?? []) {
          const p = f.properties ?? {};
          // only trees that stand there now: the BGT keeps what was removed, with the day it ended
          if (p.eind_registratie || p.status !== 'bestaand' || (p.plus_type ?? 'boom') !== 'boom') continue;
          const c = f.geometry?.coordinates;
          // a point on the cell's edge comes with both cells: it belongs to the one it lies in
          if (Array.isArray(c) && Math.floor(tileX(c[0])) === x && Math.floor(tileY(c[1])) === y) out.push(c[0], c[1]);
        }
        url = (json.links ?? []).find((l: { rel: string; href: string }) => l.rel === 'next')?.href ?? null;
      }
      if (this.cells.get(key) !== cell) return;
      cell.state = 'ready';
      cell.n = out.length / 2;
      this.count += cell.n;
      this.onCell(key, new Float64Array(out));
    } catch (err) {
      if (this.cells.get(key) !== cell) return;
      if (!String(err).includes('abort')) console.error(err);
      cell.state = 'error';
      // asked for again on a later view change
      setTimeout(() => { if (this.cells.get(key) === cell) this.cells.delete(key); }, 8000);
    } finally {
      this.loading--;
    }
  }
}
