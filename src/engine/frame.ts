// The local frame of the 3D scene: an origin on the map, with x = east and y = south in metres from it (Web Mercator
// orientation). Plain arithmetic, without three.js: the map keeps a frame in the 2D view too, where the 3D engine is
// never loaded (engine3d.ts).

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

const DEG = 180 / Math.PI;

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
