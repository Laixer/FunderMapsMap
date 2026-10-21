// Which 3D BAG tiles cover the view, found by the browser itself: walks the public 3D BAG tileset (Cesium 3D Tiles 1.1)
// from tileset.json down, opening a nested tileset-*.json only where it touches the view. Nothing is precomputed, so a new
// 3D BAG version is one URL, and our own servers never need to reach 3D BAG (on 2026-10-21 they could not; browsers could).
// Same walk as tools/3dbag-index.py, which lists the whole country for a mirror.

/** [uri relative to the base, west, south, east, north] */
export type LeafTile = [string, number, number, number, number];
type Box = [number, number, number, number];

interface Node {
  boundingVolume: { box: number[] };
  content?: { uri?: string };
  children?: Node[];
}

const A = 6378137.0;
const E2 = 6.69437999014e-3;
const B = A * Math.sqrt(1 - E2);
const EP2 = (A * A - B * B) / (B * B);
const DEG = 180 / Math.PI;

function geodetic(x: number, y: number, z: number): [number, number] {
  const p = Math.hypot(x, y);
  const th = Math.atan2(z * A, p * B);
  const lat = Math.atan2(z + EP2 * B * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3);
  return [Math.atan2(y, x) * DEG, lat * DEG];
}

/** lon/lat box around an oriented bounding box (centre + three half-axes, ECEF metres) */
function boundsOf(bv: number[]): Box {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) for (const sw of [-1, 1]) {
    const [lon, lat] = geodetic(
      bv[0] + su * bv[3] + sv * bv[6] + sw * bv[9],
      bv[1] + su * bv[4] + sv * bv[7] + sw * bv[10],
      bv[2] + su * bv[5] + sv * bv[8] + sw * bv[11],
    );
    if (lon < w) w = lon; if (lon > e) e = lon;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export class Bag3dTileset {
  /** nested tileset documents, fetched once each */
  private docs = new Map<string, Promise<Node>>();
  /** every leaf found so far, by uri (bounds computed once) */
  private known = new Map<string, LeafTile>();

  constructor(readonly base: string) {}

  private doc(uri: string): Promise<Node> {
    let p = this.docs.get(uri);
    if (!p) {
      // an unreachable 3D BAG would otherwise leave the request hanging for minutes
      p = fetch(this.base + uri, { signal: AbortSignal.timeout(20000) })
        .then((r) => { if (!r.ok) throw new Error(`3D BAG ${r.status} ${uri}`); return r.json(); })
        .then((j) => j.root as Node);
      // a failed fetch may be retried on the next view change
      p.catch(() => this.docs.delete(uri));
      this.docs.set(uri, p);
    }
    return p;
  }

  /** the leaf tiles (glb) whose box touches [west, south, east, north] */
  async leaves(view: Box): Promise<LeafTile[]> {
    const out: LeafTile[] = [];
    const walk = async (node: Node, prefix: string): Promise<void> => {
      const box = boundsOf(node.boundingVolume.box);
      if (!overlaps(box, view)) return;
      const uri = node.content?.uri;
      if (uri && uri.endsWith('.json')) {
        const nested = prefix + uri;
        const slash = nested.lastIndexOf('/');
        await walk(await this.doc(nested), slash >= 0 ? nested.slice(0, slash + 1) : '');
        return;
      }
      if (uri) {
        const key = prefix + uri;
        let leaf = this.known.get(key);
        if (!leaf) { leaf = [key, ...box]; this.known.set(key, leaf); }
        out.push(leaf);
      }
      await Promise.all((node.children ?? []).map((c) => walk(c, prefix)));
    };
    await walk(await this.doc('tileset.json'), '');
    return out;
  }
}
