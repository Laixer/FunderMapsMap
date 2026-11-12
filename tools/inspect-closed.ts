// One 3D tile after our conversion: how closed each building's mesh is (an edge used by one triangle is a hole) and
// whether its triangles face one way (KEEP_WINDING=1 shows the file as it comes).
// Run: bun tools/inspect-closed.ts [tile uri]   (VITE_3D_URL / VITE_3D_ROOT pick the source)
import { loadTile, makeFrame } from '../src/engine/tiles';

const base = process.env.VITE_3D_URL ?? 'https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/gebouwen/';
const rootName = process.env.VITE_3D_ROOT ?? '3dtiles?f=json';
const uri = process.argv[2] ?? 't/9/332/436.glb';
const T0 = performance.now();
(globalThis as any).__keepWinding = process.env.KEEP_WINDING === '1';
const root = (await (await fetch(base + rootName)).json()).root;
const tile = await loadTile(base + uri, makeFrame(4.4777, 51.9225), undefined, root.transform ?? null);
console.log(`${uri}: ${tile.features.length} rows, ${tile.parts.length} parts, converted in ${Math.round(performance.now() - T0)} ms`);
tile.parts.forEach((p, pi) => {
  const n = p.featureTriStart.length - 1;
  let open = 0, total = 0, closed = 0, withTris = 0, wall = 0, flat = 0, tiny = 0, sameWay = 0, inward = 0, outward = 0;
  const key = (i: number) => `${Math.round(p.position[i * 3] * 100)},${Math.round(p.position[i * 3 + 1] * 100)},${Math.round(p.position[i * 3 + 2] * 100)}`;
  for (let f = 0; f < n; f++) {
    const a = p.featureTriStart[f], b = p.featureTriStart[f + 1];
    if (a === b) continue;
    withTris++;
    const edges = new Map<string, number>();
    const dirs = new Map<string, number>();
    let vol = 0;
    for (let k = a; k < b; k++) {
      const t = p.featureTris[k] * 3;
      const v = [p.index[t], p.index[t + 1], p.index[t + 2]];
      const ks = v.map(key);
      for (let e = 0; e < 3; e++) {
        const x = ks[e], y = ks[(e + 1) % 3];
        if (x === y) continue;
        const kk = x < y ? `${x}|${y}` : `${y}|${x}`;
        edges.set(kk, (edges.get(kk) ?? 0) + 1);
        dirs.set(kk, (dirs.get(kk) ?? 0) + (x < y ? 1 : -1));
      }
      const [A, B, C] = v.map((i) => [p.position[i * 3], p.position[i * 3 + 1], p.position[i * 3 + 2]]);
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      if (area < 1e-4) tiny++;
      vol += A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0]);
      if (Math.abs(p.normal[v[0] * 3 + 2]) > 40) flat += area; else wall += area;
    }
    let o = 0;
    for (const c of edges.values()) if (c === 1) o++;
    open += o; total += edges.size;
    if (o === 0) closed++;
    for (const [kk, c] of edges) if (c === 2 && dirs.get(kk) !== 0) sameWay++;
    if (o === 0) { if (vol > 0) outward++; else inward++; }
  }
  console.log(`  part ${pi}: ${p.index.length / 3} triangles (${tiny} with no area); open edges ${open} of ${total}; closed buildings ${closed} of ${withTris}; wall area ${Math.round(wall)} m², roof and floor area ${Math.round(flat)} m²; shared edges wound the same way (inconsistent) ${sameWay}; closed buildings with volume sign + ${outward} / - ${inward}`);
});
