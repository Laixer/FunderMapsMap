// Reads one 3D BAG tile (Cesium 3D Tiles 1.1 glb: meshopt + quantized, EXT_mesh_features, EXT_structural_metadata)
// and turns it into plain typed arrays in a local frame that MapLibre can draw: x = east and y = south in metres from
// the frame origin (Web Mercator orientation), z = metres above the building's own ground level.
// Runs in a Web Worker (tile-worker.ts): everything it returns is transferable.
import * as THREE from 'three';
import { GLTFLoader, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

export interface Frame {
  lon: number;
  lat: number;
  /** Web Mercator origin, 0..1 */
  mx: number;
  my: number;
  /** Mercator units per metre at the origin */
  scale: number;
  /** ECEF -> east/north/up rotation at the origin, row-major */
  enu: number[];
}

export interface TileFeature {
  /** 16-digit BAG pand number */
  id: string;
  roofType: string | null;
  storeys: number | null;
  ridgeHeight: number | null;
  groundLevel: number | null;
  builtYear: number | null;
  /** ground floor area (m²), LoD 2.2 volume (m³), BAG status */
  area: number | null;
  volume: number | null;
  status: string | null;
}

export interface TilePart {
  position: Float32Array;
  /** unit normals, int8 normalized */
  normal: Int8Array;
  /** feature index per vertex (float for the shader) */
  feature: Float32Array;
  index: Uint32Array;
  /** per feature: minX, minY, minZ, maxX, maxY, maxZ (local metres) — picking and the selection outline */
  featureBoxes: Float32Array;
  /** triangles per feature: featureTris[featureTriStart[f] .. featureTriStart[f + 1]) are triangle numbers */
  featureTriStart: Uint32Array;
  featureTris: Uint32Array;
  /** crease and outline edges as line segments, with their feature */
  edgePosition: Float32Array;
  edgeFeature: Float32Array;
  /** minX, minY, minZ, maxX, maxY, maxZ of the whole part */
  bounds: number[];
}

export interface LoadedTile {
  features: TileFeature[];
  parts: TilePart[];
  bytes: number;
}

export function transferables(tile: LoadedTile): ArrayBuffer[] {
  return tile.parts.flatMap((p) => [p.position, p.normal, p.feature, p.index, p.featureBoxes, p.featureTriStart, p.featureTris, p.edgePosition, p.edgeFeature]
    .map((a) => a.buffer as ArrayBuffer));
}

const A = 6378137.0;
const E2 = 6.69437999014e-3;
const B = A * Math.sqrt(1 - E2);
const EP2 = (A * A - B * B) / (B * B);
const DEG = 180 / Math.PI;
/** faces meeting at a sharper angle than this get a line (cos 20°) */
const CREASE = Math.cos((20 * Math.PI) / 180);

export function mercatorX(lon: number): number {
  return (180 + lon) / 360;
}

export function mercatorY(lat: number): number {
  return (180 - DEG * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
}

export function makeFrame(lon: number, lat: number): Frame {
  const la = lat / DEG;
  const lo = lon / DEG;
  const sinLa = Math.sin(la), cosLa = Math.cos(la), sinLo = Math.sin(lo), cosLo = Math.cos(lo);
  return {
    lon, lat,
    mx: mercatorX(lon),
    my: mercatorY(lat),
    // MapLibre: 1 m = 1 / (earth circumference * cos(lat)) mercator units
    scale: 1 / (2 * Math.PI * 6378137 * cosLa),
    enu: [-sinLo, cosLo, 0, -sinLa * cosLo, -sinLa * sinLo, cosLa, cosLa * cosLo, cosLa * sinLo, sinLa],
  };
}

/** ECEF -> [lon, lat, ellipsoidal height] (Bowring, mm-level for buildings) */
function geodetic(x: number, y: number, z: number, out: number[]): void {
  const p = Math.hypot(x, y);
  const th = Math.atan2(z * A, p * B);
  const st = Math.sin(th), ct = Math.cos(th);
  const lat = Math.atan2(z + EP2 * B * st * st * st, p - E2 * A * ct * ct * ct);
  const sl = Math.sin(lat);
  const n = A / Math.sqrt(1 - E2 * sl * sl);
  out[0] = Math.atan2(y, x) * DEG;
  out[1] = lat * DEG;
  out[2] = p / Math.cos(lat) - n;
}

type ScalarArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const SCALARS: Record<string, new (b: ArrayBuffer) => ScalarArray> = {
  INT8: Int8Array, UINT8: Uint8Array, INT16: Int16Array, UINT16: Uint16Array,
  INT32: Int32Array, UINT32: Uint32Array, FLOAT32: Float32Array, FLOAT64: Float64Array,
};

async function bufferView(parser: GLTFParser, index: number): Promise<ArrayBuffer> {
  const view = (await parser.getDependency('bufferView', index)) as ArrayBuffer;
  // Typed arrays need an aligned, exactly sized buffer
  return view.slice(0);
}

async function readProperty(parser: GLTFParser, schema: any, table: any, name: string, count: number): Promise<(string | number | null)[]> {
  const def = schema.properties[name];
  const col = table.properties[name];
  const out: (string | number | null)[] = new Array(count).fill(null);
  if (!def || !col) return out;
  if (def.type === 'STRING') {
    const bytes = new Uint8Array(await bufferView(parser, col.values));
    const offsets = new SCALARS[col.stringOffsetType ?? 'UINT32'](await bufferView(parser, col.stringOffsets));
    const decoder = new TextDecoder();
    for (let i = 0; i < count; i++) out[i] = decoder.decode(bytes.subarray(Number(offsets[i]), Number(offsets[i + 1]))) || null;
    return out;
  }
  if (def.type === 'SCALAR') {
    const values = new SCALARS[def.componentType](await bufferView(parser, col.values));
    for (let i = 0; i < count; i++) out[i] = values[i] === def.noData || (def.componentType === 'FLOAT32' && values[i] > 3e38) ? null : values[i];
  }
  return out;
}

/**
 * Property names per source: 3D BAG (b3_*) and PDOK 3D Basisvoorziening (roofer rf_*, camelCase BAG names). The first
 * name a tile carries wins.
 */
const NAMES = {
  id: ['identificatie'],
  roof: ['b3_dak_type', 'rf_roof_type'],
  storeys: ['b3_bouwlagen'],
  ridge: ['b3_h_nok', 'rf_h_roof_ridge'],
  ground: ['b3_h_maaiveld', 'rf_h_ground'],
  year: ['oorspronkelijkbouwjaar', 'oorspronkelijkBouwjaar'],
  area: ['b3_opp_grond'],
  volume: ['b3_volume_lod22', 'rf_volume_lod22'],
  status: ['status'],
};

/** transform = the tile's 3D Tiles transform (column-major), applied after glTF y-up → z-up; null when content is in ECEF */
export async function loadTile(url: string, frame: Frame, signal?: AbortSignal, transform: number[] | null = null): Promise<LoadedTile> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buffer = await res.arrayBuffer();
  const gltf = await loader.parseAsync(buffer, '');
  const parser = gltf.parser;
  const metadata = parser.json.extensions?.EXT_structural_metadata;
  const table = metadata?.propertyTables?.[0];
  if (!table) throw new Error(`no property table in ${url}`);
  const schema = metadata.schema.classes[table.class];
  const count: number = table.count;
  const column = async (names: string[]) => {
    const name = names.find((n) => schema.properties[n] && table.properties[n]);
    return name ? readProperty(parser, schema, table, name, count) : new Array(count).fill(null);
  };
  const [ids, roof, storeys, ridge, ground, year, area, volume, status] = await Promise.all(
    [NAMES.id, NAMES.roof, NAMES.storeys, NAMES.ridge, NAMES.ground, NAMES.year, NAMES.area, NAMES.volume, NAMES.status].map(column),
  );
  const features: TileFeature[] = [];
  for (let i = 0; i < count; i++) {
    features.push({
      id: String(ids[i] ?? '').slice(-16),
      roofType: roof[i] as string | null,
      storeys: storeys[i] as number | null,
      ridgeHeight: ridge[i] as number | null,
      groundLevel: ground[i] as number | null,
      builtYear: year[i] === null ? null : Number(year[i]) || null,
      area: area[i] as number | null,
      volume: volume[i] as number | null,
      status: status[i] as string | null,
    });
  }

  gltf.scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });

  const parts = meshes.map((mesh) => buildPart(mesh, frame, count, transform));
  for (const mesh of meshes) mesh.geometry.dispose();
  return { features, parts, bytes: buffer.byteLength };
}

/** an exact key per source vertex position: the quantized int16 triple when there is one, else the float text */
function positionKeys(pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): (number | string)[] {
  const array = (pos as THREE.InterleavedBufferAttribute).data?.array ?? (pos as THREE.BufferAttribute).array;
  const keys = new Array<number | string>(pos.count);
  if (pos.normalized && array instanceof Int16Array) {
    for (let i = 0; i < pos.count; i++) {
      const x = Math.round(pos.getX(i) * 32767) + 32768;
      const y = Math.round(pos.getY(i) * 32767) + 32768;
      const z = Math.round(pos.getZ(i) * 32767) + 32768;
      keys[i] = (x * 65536 + y) * 65536 + z;
    }
  } else {
    for (let i = 0; i < pos.count; i++) keys[i] = `${pos.getX(i)},${pos.getY(i)},${pos.getZ(i)}`;
  }
  return keys;
}

function buildPart(mesh: THREE.Mesh, frame: Frame, featureCount: number, t: number[] | null): TilePart {
  const src = mesh.geometry;
  const pos = src.attributes.position;
  const nrm = src.attributes.normal;
  const fid = src.attributes._feature_id_0;
  const n = pos.count;
  const m = mesh.matrixWorld.elements;
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld).elements;
  const r = frame.enu;

  const position = new Float32Array(n * 3);
  const normal = new Int8Array(n * 3);
  const feature = new Float32Array(n);
  const vertexFeature = new Uint32Array(n);
  const ground = new Float64Array(featureCount).fill(Infinity);
  const g = [0, 0, 0];

  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // node matrix -> glTF world (y-up); 3D Tiles: glTF y-up -> ECEF z-up is (x, -z, y)
    const gx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const gy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const gz = m[2] * x + m[6] * y + m[10] * z + m[14];
    // z-up tile frame (x, -z, y), then the tile transform into ECEF when the tileset has one (PDOK: ENU at the root)
    const lx = gx, ly = -gz, lz = gy;
    if (t) geodetic(t[0] * lx + t[4] * ly + t[8] * lz + t[12], t[1] * lx + t[5] * ly + t[9] * lz + t[13], t[2] * lx + t[6] * ly + t[10] * lz + t[14], g);
    else geodetic(lx, ly, lz, g);
    position[i * 3] = (mercatorX(g[0]) - frame.mx) / frame.scale;
    position[i * 3 + 1] = (mercatorY(g[1]) - frame.my) / frame.scale;
    position[i * 3 + 2] = g[2];
    const f = fid ? Math.round(fid.getX(i)) : 0;
    feature[i] = f;
    vertexFeature[i] = f;
    if (g[2] < ground[f]) ground[f] = g[2];

    let nx = 0, ny = 0, nz = 1;
    if (nrm) {
      const a = nrm.getX(i), b = nrm.getY(i), c = nrm.getZ(i);
      const wx = nm[0] * a + nm[3] * b + nm[6] * c;
      const wy = nm[1] * a + nm[4] * b + nm[7] * c;
      const wz = nm[2] * a + nm[5] * b + nm[8] * c;
      // z-up tile frame, then the transform's rotation into ECEF
      let ex = wx, ey = -wz, ez = wy;
      if (t) [ex, ey, ez] = [t[0] * ex + t[4] * ey + t[8] * ez, t[1] * ex + t[5] * ey + t[9] * ez, t[2] * ex + t[6] * ey + t[10] * ez];
      const e = r[0] * ex + r[1] * ey + r[2] * ez;
      const no = r[3] * ex + r[4] * ey + r[5] * ez;
      const u = r[6] * ex + r[7] * ey + r[8] * ez;
      const len = Math.hypot(e, no, u) || 1;
      nx = e / len; ny = -no / len; nz = u / len; // y points south in the local frame
    }
    normal[i * 3] = Math.round(nx * 127);
    normal[i * 3 + 1] = Math.round(ny * 127);
    normal[i * 3 + 2] = Math.round(nz * 127);
  }

  // MapLibre has no terrain here: stand every building on z = 0 at its own lowest point
  const featureBoxes = new Float32Array(featureCount * 6);
  for (let f = 0; f < featureCount; f++) featureBoxes.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], f * 6);
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const f = vertexFeature[i];
    position[i * 3 + 2] -= ground[f];
    for (let k = 0; k < 3; k++) {
      const v = position[i * 3 + k];
      if (v < featureBoxes[f * 6 + k]) featureBoxes[f * 6 + k] = v;
      if (v > featureBoxes[f * 6 + 3 + k]) featureBoxes[f * 6 + 3 + k] = v;
      if (v < bounds[k]) bounds[k] = v;
      if (v > bounds[3 + k]) bounds[3 + k] = v;
    }
  }

  const index = src.index ? Uint32Array.from(src.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
  const triangles = index.length / 3;
  const featureTriStart = new Uint32Array(featureCount + 1);
  for (let t = 0; t < triangles; t++) featureTriStart[vertexFeature[index[t * 3]] + 1]++;
  for (let f = 0; f < featureCount; f++) featureTriStart[f + 1] += featureTriStart[f];
  const featureTris = new Uint32Array(triangles);
  const fill = featureTriStart.slice(0, featureCount);
  for (let t = 0; t < triangles; t++) featureTris[fill[vertexFeature[index[t * 3]]]++] = t;

  const { edgePosition, edgeFeature } = buildEdges(position, index, positionKeys(pos), featureTriStart, featureTris);
  return { position, normal, feature, index, featureBoxes, featureTriStart, featureTris, edgePosition, edgeFeature, bounds };
}

/**
 * Architectural lines: per building, every edge where two faces meet at more than 20°, plus open edges.
 * Vertices are split per face in the glb (flat normals), so edges are matched on the exact source position.
 */
function buildEdges(position: Float32Array, index: Uint32Array, keys: (number | string)[],
  featureTriStart: Uint32Array, featureTris: Uint32Array): { edgePosition: Float32Array; edgeFeature: Float32Array } {
  const ids = new Uint32Array(keys.length);
  const seen = new Map<number | string, number>();
  for (let i = 0; i < keys.length; i++) {
    let id = seen.get(keys[i]);
    if (id === undefined) { id = seen.size; seen.set(keys[i], id); }
    ids[i] = id;
  }
  const out: number[] = [];
  const outFeature: number[] = [];
  const edges = new Map<number, number>();
  const nrm: number[] = [];
  const cnt: number[] = [];
  const sharp: boolean[] = [];
  const ends: number[] = [];
  const features = featureTriStart.length - 1;
  for (let f = 0; f < features; f++) {
    edges.clear();
    nrm.length = cnt.length = sharp.length = ends.length = 0;
    for (let k = featureTriStart[f]; k < featureTriStart[f + 1]; k++) {
      const t = featureTris[k] * 3;
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const ux = position[b * 3] - position[a * 3], uy = position[b * 3 + 1] - position[a * 3 + 1], uz = position[b * 3 + 2] - position[a * 3 + 2];
      const vx = position[c * 3] - position[a * 3], vy = position[c * 3 + 1] - position[a * 3 + 1], vz = position[c * 3 + 2] - position[a * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) continue;
      nx /= len; ny /= len; nz /= len;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const ip = ids[p], iq = ids[q];
        if (ip === iq) continue;
        const key = ip < iq ? ip * 1048576 + iq : iq * 1048576 + ip;
        const slot = edges.get(key);
        if (slot === undefined) {
          edges.set(key, cnt.length);
          nrm.push(nx, ny, nz);
          cnt.push(1);
          sharp.push(false);
          ends.push(p, q);
        } else {
          cnt[slot]++;
          if (nrm[slot * 3] * nx + nrm[slot * 3 + 1] * ny + nrm[slot * 3 + 2] * nz < CREASE) sharp[slot] = true;
        }
      }
    }
    for (let s = 0; s < cnt.length; s++) {
      if (cnt[s] !== 1 && !sharp[s]) continue;
      const p = ends[s * 2], q = ends[s * 2 + 1];
      out.push(position[p * 3], position[p * 3 + 1], position[p * 3 + 2], position[q * 3], position[q * 3 + 1], position[q * 3 + 2]);
      outFeature.push(f, f);
    }
  }
  return { edgePosition: new Float32Array(out), edgeFeature: new Float32Array(outFeature) };
}
