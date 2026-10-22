// Print the first features' properties of one Martin vector tile: bun tools/peek-tile.ts <source> <z>/<x>/<y> [n]
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const [source, zxy, n = '3'] = process.argv.slice(2);
const res = await fetch(`https://tiles.fundermaps.com/${source}/${zxy}`);
const tile = new VectorTile(new Pbf(new Uint8Array(await res.arrayBuffer())));
for (const [name, layer] of Object.entries(tile.layers)) {
  console.log(`${source} ${zxy}: layer ${name}, ${layer.length} features`);
  for (let i = 0; i < Math.min(Number(n), layer.length); i++) console.log('  ', JSON.stringify(layer.feature(i).properties));
}
