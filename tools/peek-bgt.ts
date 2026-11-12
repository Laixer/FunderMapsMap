// What PDOK's BGT vector tiles hold around a point, per zoom: layers, feature counts, the properties of a tree.
// Run: bun tools/peek-bgt.ts [lon lat]
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const lon = Number(process.argv[2] ?? 4.3985), lat = Number(process.argv[3] ?? 51.9172);
const base = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/tiles/WebMercatorQuad';
for (const z of [13, 14, 15, 16, 17]) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
  const res = await fetch(`${base}/${z}/${y}/${x}?f=mvt`);
  if (!res.ok) { console.log(`z${z}: ${res.status}`); continue; }
  const buf = await res.arrayBuffer();
  const tile = new VectorTile(new Pbf(buf));
  const names = Object.keys(tile.layers);
  const veg = names.filter((n) => /vegetatie/.test(n));
  console.log(`z${z}: ${buf.byteLength} bytes (${res.headers.get('content-encoding') ?? 'plain'}), cors ${res.headers.get('access-control-allow-origin')}, ${names.length} layers; ${veg.map((n) => `${n} ${tile.layers[n].length}`).join(', ') || 'no vegetation layer'}`);
  const l = tile.layers.vegetatieobject_punt;
  if (l?.length) {
    const f = l.feature(0);
    console.log('   a tree:', JSON.stringify(f.properties).slice(0, 300), '| extent', l.extent, '| point', JSON.stringify(f.loadGeometry()[0][0]));
    let ended = 0, types: Record<string, number> = {};
    for (let i = 0; i < l.length; i++) { const p = l.feature(i).properties; if (p.eind_registratie) ended++; types[String(p.plus_type ?? p.type)] = (types[String(p.plus_type ?? p.type)] ?? 0) + 1; }
    console.log('   ended:', ended, 'types:', JSON.stringify(types));
  }
}
