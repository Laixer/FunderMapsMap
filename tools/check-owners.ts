// The ownership layer (src/engine/themes.ts, updateOwners) checked without a browser: the ranking, the colours that
// stay with their owner while the view changes, the shared row, and the rule as MapLibre takes it. With tiles
// (z/x/y of our `buildings` source) it first prints the legend those tiles give together, as a first view would.
// Run: bun tools/check-owners.ts [z/x/y ...]     e.g. bun tools/check-owners.ts 14/8404/5425 14/8405/5425
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { THEMES, countLegend, evaluateTheme, layerStyle, legendColors, legendRows, legendTitle, mapsetThemes, setLegends, updateOwners, type Props } from '../src/engine/themes';
import { OWNER_COLORS, OWNER_OTHER, parseColor, toHex } from '../src/engine/palette';

let failed = 0;
function check(what: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`);
}

const theme = THEMES.find((t) => t.id === 'owner')!;
const N = OWNER_COLORS.length;
/** buildings for owner → count; '' = buildings without an owner */
const view = (owners: Record<string, number>): Props[] =>
  Object.entries(owners).flatMap(([owner, n]) => Array.from({ length: n }, () => (owner ? { owner } : { construction_year: 1950 })));
/** the legend of these buildings: rows with counts, the generic "Overig" count and the count not in the layer */
function legend(buildings: Props[]) {
  const changed = updateOwners(buildings);
  const result = evaluateTheme(theme, buildings, '2026');
  const counted = countLegend(result, 0, buildings.length);
  return { changed, rows: counted.sections[0].rows, other: counted.sections[0].other, none: counted.none, result };
}
const colorOf = (rows: { name: string; color: number }[], name: string) => rows.find((r) => r.name === name)?.color;

// ---- the layer exists before any building is loaded ----
check('THEMES has the layer in the group Pand', theme?.group === 'Pand' && theme.name === 'Eigendom');
check('legend title', legendTitle('owner') === 'Eigendom');
check('the colour strip is the palette', legendColors(theme, '2026').length === N + 1 && legendColors(theme, 'current').length === N + 1);
const fromMapset = mapsetThemes('Kaart', [{ id: 'owner', name: 'Eigendom' }, { id: 'retired-layer', name: 'Weg' }]);
check('mapsetThemes keeps the layer and drops an unknown one', fromMapset.length === 1 && fromMapset[0].id === 'owner' && fromMapset[0].name === 'Eigendom' && fromMapset[0].group === 'Kaart');
// a mapset's own legend for the layer does not replace the runtime one
setLegends([{ id: 'owner', name: 'Uit de database', fields: [{ name: 'Rij uit de database', color: '112233' }] }]);
check('the runtime legend goes before a mapset legend', legendTitle('owner') === 'Eigendom' && !legendRows('owner').some((r) => r.name === 'Rij uit de database'));
setLegends([]);
const all = [...OWNER_COLORS, OWNER_OTHER].map((c) => parseColor(c));
check('every colour parses and no two are the same', all.every((c) => c !== null) && new Set(all).size === N + 1);

// ---- real tiles, before anything else hands out colours ----
const tiles = process.argv.slice(2);
if (tiles.length) {
  const byId = new Map<string, Props>();
  for (const zxy of tiles) {
    const res = await fetch(`https://tiles.fundermaps.com/buildings/${zxy}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const layer = bytes.length ? new VectorTile(new Pbf(bytes)).layers.buildings : undefined;
    for (let i = 0; layer && i < layer.length; i++) {
      const p = layer.feature(i).properties as Props;
      byId.set(String(p.building_id), p);
    }
  }
  const buildings = [...byId.values()];
  const l = legend(buildings);
  console.log(`\n${tiles.length} tile(s): ${buildings.length} buildings, ${buildings.filter((b) => b.owner).length} with an owner`);
  for (const r of l.rows) console.log(`  ${toHex(r.color)}  ${String(r.count).padStart(6)}  ${r.name}`);
  console.log(`  generic Overig ${l.other}, not in the layer ${l.none}\n`);
  check('every building with an owner is in a row', l.other === 0 && l.rows.reduce((s, r) => s + r.count, 0) === buildings.filter((b) => typeof b.owner === 'string' && b.owner).length);
  check('the owner with the most buildings has the first colour', !l.rows.length || l.rows[0].color === parseColor(OWNER_COLORS[0]));
}

// ---- three owners: three rows, no shared row, buildings without an owner are not in the layer ----
const south = view({ 'Wonen Zuid': 40, 'Huis en Haard': 25, Thuisbasis: 25, '': 10 });
let l = legend(south);
check('three owners give three rows, most buildings first, equal counts by name', l.rows.map((r) => `${r.name}:${r.count}`).join('|') === 'Wonen Zuid:40|Huis en Haard:25|Thuisbasis:25');
check('no shared row without other owners', !l.rows.some((r) => r.name === 'Overig corporatiebezit'));
check('nothing in the generic Overig, the rest not in the layer', l.other === 0 && l.none === 10);
check('a second run over the same buildings changes nothing', updateOwners(south) === false);
check('a building without an owner has no colour', l.result.colors[south.length - 1] === -1 && l.result.rows[south.length - 1] === -1);
check('each row has its own colour', new Set(l.rows.map((r) => r.color)).size === 3);

// ---- more owners than colours: the rest share one row ----
const many: Record<string, number> = { '': 5 };
for (let i = 0; i < N + 4; i++) many[`Corporatie ${String(i).padStart(2, '0')}`] = 100 - i;
const crowded = view(many);
l = legend(crowded);
check(`${N + 4} owners give ${N} rows and the shared row`, l.rows.length === N + 1 && l.rows[N].name === 'Overig corporatiebezit');
check('the shared row counts the other owners, in its own colour', l.rows[N].count === 4 * (100 - N) - 6 && l.rows[N].color === parseColor(OWNER_OTHER), `${l.rows[N].count}`);
check('nothing in the generic Overig', l.other === 0 && l.none === 5);
check('all colours in use are different', new Set(l.rows.map((r) => r.color)).size === N + 1);
const crowdedColors = new Map(l.rows.map((r) => [r.name, r.color]));

// ---- colours stay with their owner ----
// the order changes (rows by count), the colours do not
l = legend(view({ ...many, 'Corporatie 05': 500 }));
check('a new order moves the rows', l.changed && l.rows[0].name === 'Corporatie 05');
check('and keeps every colour', l.rows.slice(0, N).every((r) => crowdedColors.get(r.name) === r.color));
// one owner leaves the legend and comes back while nobody needed its colour
updateOwners(view({ A: 9, B: 8, C: 7 }));
const before = new Map(legendRows('owner').map((r) => [r.name, r.color]));
updateOwners(view({ A: 9, C: 7 }));
updateOwners(view({ A: 9, B: 8, C: 7, D: 1 }));
const after = new Map(legendRows('owner').map((r) => [r.name, r.color]));
check('an owner out of view and back keeps its colour', ['A', 'B', 'C'].every((o) => before.get(o) === after.get(o)) && after.get('D') !== undefined);
check('the newcomer took a colour nobody in the legend has', new Set(after.values()).size === after.size);
// every colour taken: new owners take the colours of the owners longest out of the legend, the smallest of them first
l = legend(crowded);
const full = new Map(l.rows.slice(0, N).map((r) => [r.name, r.color]));
const biggest = l.rows.slice(0, N - 2).map((r) => r.name);
l = legend(view({ 'Nieuw 1': 5, 'Nieuw 2': 4 }));
check('with every colour taken two new owners still get one each', l.rows.length === 2 && l.rows[0].color !== l.rows[1].color && l.other === 0);
l = legend(view(Object.fromEntries(biggest.map((name) => [name, many[name]]))));
check('they took the colours of the two smallest owners, the others keep theirs', l.rows.length === N - 2 && l.rows.every((r) => full.get(r.name) === r.color));
// the three owners of the first view again
l = legend(south);
check('owners coming back get a colour each', l.rows.length === 3 && new Set(['Wonen Zuid', 'Huis en Haard', 'Thuisbasis'].map((o) => colorOf(l.rows, o))).size === 3 && l.other === 0);

// ---- the rule as MapLibre takes it (the 2D layers) ----
l = legend(crowded);
const style = layerStyle('owner', '2026');
const fence = ['any', ['!', ['has', 'municipality_id']], ['in', ['get', 'municipality_id'], ['literal', ['GM0599']]]];
const errors = validateStyleMin({
  version: 8,
  sources: { fm: { type: 'vector', url: 'https://example.invalid/buildings' } },
  layers: [
    { id: 'plain', type: 'fill', source: 'fm', 'source-layer': 'buildings', filter: style.filter, paint: { 'fill-color': style.color } },
    { id: 'fenced', type: 'fill-extrusion', source: 'fm', 'source-layer': 'buildings', filter: ['all', style.filter, fence], paint: { 'fill-extrusion-color': style.color } },
    { id: 'context', type: 'fill', source: 'fm', 'source-layer': 'buildings', filter: ['!', ['any', ['all', style.filter, fence]]], paint: { 'fill-color': '#4a525d' } },
  ],
} as any);
check('the filter and the colour are a valid MapLibre layer', errors.length === 0 && style.source === 'buildings', errors.map((e) => e.message).join('; '));
check('the same rule in both palettes', JSON.stringify(layerStyle('owner', 'current')) === JSON.stringify(style));
const empty = legend([]);
check('no buildings: no rows, and still a valid rule', empty.rows.length === 0 && typeof layerStyle('owner', '2026').color === 'string');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
