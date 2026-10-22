// Which 3D building tiles cover the view, found by the browser itself: walks a public Cesium 3D Tiles 1.1 tileset from its
// root down, opening a nested tileset-*.json only where it touches the view. Works for PDOK 3D Basisvoorziening (the
// default: Kadaster, region bounding volumes, one ENU→ECEF transform at the root) and for 3D BAG (box volumes, content
// already in ECEF). Nothing is precomputed, so a new version or a mirror of ours is just another base URL.

/** a leaf tile with content: uri relative to the base, lon/lat box, and the tile transform to apply (column-major) */
export interface LeafTile {
  uri: string;
  bounds: [number, number, number, number];
  transform: number[] | null;
}
type Box = [number, number, number, number];

interface Node {
  boundingVolume: { box?: number[]; region?: number[] };
  transform?: number[];
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

/** column-major 4×4 product a·b */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

function apply(t: number[] | null, x: number, y: number, z: number): [number, number, number] {
  if (!t) return [x, y, z];
  return [t[0] * x + t[4] * y + t[8] * z + t[12], t[1] * x + t[5] * y + t[9] * z + t[13], t[2] * x + t[6] * y + t[10] * z + t[14]];
}

/** lon/lat box of a bounding volume: a region is lon/lat already (radians); a box is centre + half-axes in the tile frame */
function boundsOf(bv: Node['boundingVolume'], t: number[] | null): Box {
  if (bv.region) return [bv.region[0] * DEG, bv.region[1] * DEG, bv.region[2] * DEG, bv.region[3] * DEG];
  const b = bv.box!;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) for (const sw of [-1, 1]) {
    const [lon, lat] = geodetic(...apply(t,
      b[0] + su * b[3] + sv * b[6] + sw * b[9],
      b[1] + su * b[4] + sv * b[7] + sw * b[10],
      b[2] + su * b[5] + sv * b[8] + sw * b[11],
    ));
    if (lon < w) w = lon; if (lon > e) e = lon;
    if (lat < s) s = lat; if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export class Bag3dTileset {
  /** nested tileset documents, fetched once each */
  private docs = new Map<string, Promise<Node>>();
  /** every leaf found so far, by uri (one object per tile, bounds computed once) */
  private known = new Map<string, LeafTile>();

  constructor(readonly base: string, private root = 'tileset.json') {}

  private doc(uri: string): Promise<Node> {
    let p = this.docs.get(uri);
    if (!p) {
      // an unreachable server would otherwise leave the request hanging for minutes
      p = fetch(this.base + uri, { signal: AbortSignal.timeout(20000) })
        .then((r) => { if (!r.ok) throw new Error(`3D tiles ${r.status} ${uri}`); return r.json(); })
        .then((j) => j.root as Node);
      // a failed fetch may be retried on the next view change
      p.catch(() => this.docs.delete(uri));
      this.docs.set(uri, p);
    }
    return p;
  }

  /** the leaf tiles (with content) whose box touches [west, south, east, north] */
  async leaves(view: Box): Promise<LeafTile[]> {
    const out: LeafTile[] = [];
    const walk = async (node: Node, prefix: string, parent: number[] | null): Promise<void> => {
      // transforms add up from the root down, through nested tilesets too (3D Tiles 1.1)
      const t = node.transform ? (parent ? multiply(parent, node.transform) : node.transform) : parent;
      const box = boundsOf(node.boundingVolume, t);
      if (!overlaps(box, view)) return;
      const uri = node.content?.uri;
      if (uri && uri.includes('.json')) {
        const nested = prefix + uri;
        const slash = nested.lastIndexOf('/');
        await walk(await this.doc(nested), slash >= 0 ? nested.slice(0, slash + 1) : '', t);
        return;
      }
      // refine REPLACE: content on a node with children is a coarser stand-in; the children replace it
      if (uri && !node.children?.length) {
        const key = prefix + uri;
        let leaf = this.known.get(key);
        if (!leaf) { leaf = { uri: key, bounds: box, transform: t }; this.known.set(key, leaf); }
        out.push(leaf);
      }
      await Promise.all((node.children ?? []).map((c) => walk(c, prefix, t)));
    };
    await walk(await this.doc(this.root), '', null);
    return out;
  }
}
