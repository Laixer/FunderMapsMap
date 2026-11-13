// Map themes: the live map app's drawing rules (WebFront src/config/layers/*.json, frozen in rules.json) evaluated
// per building with MapLibre's own style-spec engine, so every building gets exactly the colour the 2D map draws.
// Legends are the DB rows (application.mapset_layer.fields, frozen in legends.json). The '2026' palette swaps
// colours in both, row by row (palette.ts). One layer is not frozen: the ownership layer's rule and legend are made
// here from the buildings loaded (updateOwners).
import { expression, featureFilter, latest } from '@maplibre/maplibre-gl-style-spec';
import RULES from './rules.json';
import LEGENDS from './legends.json';
import AREA_LAYERS from '@/config/area-layers.json';
import { OWNER_COLORS, OWNER_OTHER, colorDistance, parseColor, recolorExpression, remap, type PaletteName } from './palette';

export type Props = Record<string, string | number | boolean>;

export interface Section {
  title: string;
  /** layer whose DB legend rows are shown */
  legend: string;
  /** layers whose buildings are counted in this section */
  layers: string[];
}

export interface Theme {
  id: string;
  group: string;
  name: string;
  /** first layer whose filter passes colours the building (top of the 2D stack first) */
  layers: string[];
  sections?: Section[];
  note?: string;
  /** an area layer (src/config/area-layers.json) drawn on the ground instead of colouring buildings */
  area?: string;
}

const FOUNDATION_TYPES = ['foundation-type-established', 'foundation-type-cluster', 'foundation-type-indicative'];

export const GROUPS = ['Fundering', 'Pand', 'Risico', 'Rapportage', 'Gevelscan', 'Meldingen'];

export const THEMES: Theme[] = [
  {
    id: 'foundation', group: 'Fundering', name: 'Funderingstype',
    layers: ['foundation-recovery', ...FOUNDATION_TYPES],
    sections: [
      { title: 'Funderingstype', legend: 'foundation-type-established', layers: FOUNDATION_TYPES },
      { title: 'Hersteld', legend: 'foundation-recovery', layers: ['foundation-recovery'] },
    ],
    note: 'Vastgesteld, afgeleid en indicatief samen, zoals de lagen op elkaar in de kaart; herstelde panden in hun herstelkleur.',
  },
  { id: 'foundation-type-established', group: 'Fundering', name: 'Vastgesteld', layers: ['foundation-type-established'] },
  { id: 'foundation-type-cluster', group: 'Fundering', name: 'Afgeleid', layers: ['foundation-type-cluster'] },
  { id: 'foundation-type-indicative', group: 'Fundering', name: 'Indicatief', layers: ['foundation-type-indicative'] },
  { id: 'foundation-recovery', group: 'Fundering', name: 'Funderingsherstel', layers: ['foundation-recovery'] },
  { id: 'velocity', group: 'Fundering', name: 'Pandzakking', layers: ['velocity'] },
  { id: 'construction-year', group: 'Pand', name: 'Bouwjaar', layers: ['construction-year'] },
  { id: 'owner', group: 'Pand', name: 'Eigendom', layers: ['owner'] },
  { id: 'unclassified-risk', group: 'Risico', name: 'Funderingsrisico', layers: ['unclassified-risk'], note: 'Op basis van onderzoek.' },
  { id: 'drystand-risk', group: 'Risico', name: 'Droogstand', layers: ['drystand-risk'] },
  { id: 'dewatering-depth-risk', group: 'Risico', name: 'Ontwateringsdiepte', layers: ['dewatering-depth-risk'] },
  { id: 'bio-infection-risk', group: 'Risico', name: 'Bacteriële aantasting', layers: ['bio-infection-risk'] },
  { id: 'hotspot', group: 'Risico', name: 'Hotspot', layers: ['hotspot'] },
  { id: 'restoration-cost', group: 'Risico', name: 'Herstelkosten', layers: ['restoration-cost'] },
  { id: 'inquiry-type', group: 'Rapportage', name: 'Rapportagetype', layers: ['inquiry-type'] },
  { id: 'damage-cause', group: 'Rapportage', name: 'Schadeoorzaak', layers: ['damage-cause'] },
  { id: 'overall-quality', group: 'Rapportage', name: 'Kwaliteit', layers: ['overall-quality'] },
  { id: 'enforcement-term', group: 'Rapportage', name: 'Handhavingstermijn', layers: ['enforcement-term'] },
  { id: 'monitoring', group: 'Rapportage', name: 'Monitoring', layers: ['monitoring'] },
  { id: 'contractor', group: 'Rapportage', name: 'Uitvoerder', layers: ['contractor'] },
  // Gevelscan (Verkennend Funderingsonderzoek, facade_scan tiles). skewed-parallel reads skewed_perpendicular_facade and
  // the other way round, exactly as in the current map app (its legends: Loodmeting / Lintvoegmeting) — question open.
  { id: 'facade-risk-established', group: 'Gevelscan', name: 'Risico', layers: ['facade-risk-established'] },
  { id: 'facade-risk', group: 'Gevelscan', name: 'Risico pand (model)', layers: ['facade-risk'] },
  { id: 'facade-type', group: 'Gevelscan', name: 'Scheuren', layers: ['facade-type'] },
  { id: 'skewed-parallel', group: 'Gevelscan', name: 'Loodmeting', layers: ['skewed-parallel'] },
  { id: 'skewed-perpendicular', group: 'Gevelscan', name: 'Lintvoegmeting', layers: ['skewed-perpendicular'] },
  // Meldingen: the buildings with a melding, and the counts per buurt, wijk and gemeente as areas on the ground
  { id: 'incident', group: 'Meldingen', name: 'Panden met een melding', layers: ['incident'] },
  { id: 'incident-neighborhood', group: 'Meldingen', name: 'Per buurt', layers: [], area: 'incident-neighborhood' },
  { id: 'incident-district', group: 'Meldingen', name: 'Per wijk', layers: [], area: 'incident-district' },
  { id: 'incident-municipality', group: 'Meldingen', name: 'Per gemeente', layers: [], area: 'incident-municipality' },
];

/** packed 0xRRGGBB, or -1 when no layer of the theme draws the building */
export const NONE = -1;

interface Compiled {
  filter: (globals: any, feature: any) => boolean;
  color: { evaluate: (globals: any, feature: any) => { r: number; g: number; b: number; a: number } };
  /** property behind an ['interpolate', …, ['get', p], …] colour: counted by value, not by colour */
  interpolatedOn: string | null;
  legend: { name: string; color: number }[];
  /** properties the filter and colour read: buildings with the same values get the same answer */
  props: string[];
}

function referenced(expr: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(expr)) {
    if ((expr[0] === 'get' || expr[0] === 'has') && typeof expr[1] === 'string') out.add(expr[1]);
    for (const e of expr) referenced(e, out);
  }
  return out;
}

const compiled = new Map<string, Compiled>();
const COLOR_SPEC = (latest as any)['paint_fill-extrusion']['fill-extrusion-color'];
type Legend = { name: string; fields: { name: string; color: string }[] };
/** a drawing rule as rules.json holds them: filter and colour are MapLibre expressions */
interface Rule { filter: unknown; color: unknown; source: string; sourceFilter: unknown }
/** legends of the open mapset (its layer set, at runtime); the frozen DB legends for everything else */
let runtimeLegends = new Map<string, Legend>();
/**
 * Layers made at runtime: their rule and legend go before the frozen ones, and before a mapset's own legend. `strip`
 * is the colour strip in the layer list, which stays the same while the legend follows the view.
 */
const dynamic = new Map<string, { rule: Rule; legend: Legend; strip: number[] }>();
const ruleOf = (id: string): any => dynamic.get(id)?.rule ?? (RULES as Record<string, any>)[id];
const legendOf = (id: string): Legend => dynamic.get(id)?.legend ?? runtimeLegends.get(id) ?? (LEGENDS as Record<string, Legend>)[id];

/** use these legends (a mapset's layer set) over the frozen ones; [] goes back to the frozen ones */
export function setLegends(layers: { id: string; name: string; fields: { name: string; color: string }[] }[]) {
  runtimeLegends = new Map(layers.filter((l) => l.fields?.length).map((l) => [l.id, { name: l.name, fields: l.fields }]));
  compiled.clear();
}

// ---- the ownership layer ---------------------------------------------------------------------------------------------
// Who owns a building (the `owner` of our tiles: a name, mostly a housing corporation's). There are hundreds of
// owners, far too many for a legend, so this layer's rule and legend are made from the buildings loaded: the owners
// with the most buildings get a colour and a legend row each, every other owner shares one colour and one row. A
// building without an owner is not in the layer.
const OWNER = 'owner';
const OTHER_OWNERS = 'Overig corporatiebezit';
/**
 * Not an owner by name: in a few municipalities the data says "Particulier" for a privately owned building (83,687
 * buildings on 2026-11-13, the largest single value where it occurs). The layer shows whose property a building is, so
 * these are left out of it like a building without an owner, instead of filling the map and the first legend row.
 * A mixed value ("Particulier/<corporation>") names a corporation and stays.
 */
const PRIVATE = 'Particulier';
/**
 * owner → its place in OWNER_COLORS, for as long as the page lives, so an owner keeps its colour while the map moves.
 * In order of last use: when a new owner needs a colour and none is free, the owner longest out of the legend gives up
 * theirs.
 */
const ownerSlot = new Map<string, number>();
/** the legend rows of the rule in use, to tell whether a new ranking changes anything */
let ownerRows: string | null = null;

/**
 * Rank the owners of these buildings and make the ownership layer's rule and legend from them: as many owners as there
 * are colours, those with the most buildings (equal counts by name), most buildings first. True when the rule or the
 * legend changed: what was compiled for the old one is dropped here, drawing again is the caller's.
 */
export function updateOwners(buildings: Props[]): boolean {
  const counts = new Map<string, number>();
  for (const b of buildings) {
    const name = b.owner;
    if (typeof name === 'string' && name && name !== PRIVATE) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, OWNER_COLORS.length).map(([name]) => name);
  const top = new Set(ranked);
  for (const name of ranked) {
    if (ownerSlot.has(name)) continue;
    // a colour no owner holds; else the colour of the owner longest out of the legend, who loses it
    const held = new Set(ownerSlot.values());
    let slot = OWNER_COLORS.findIndex((_, i) => !held.has(i));
    if (slot < 0) for (const [other, s] of ownerSlot) if (!top.has(other)) { ownerSlot.delete(other); slot = s; break; }
    ownerSlot.set(name, slot);
  }
  // used now: back to the end of the line, the owner with the most buildings last of all
  for (let i = ranked.length - 1; i >= 0; i--) {
    const slot = ownerSlot.get(ranked[i])!;
    ownerSlot.delete(ranked[i]);
    ownerSlot.set(ranked[i], slot);
  }
  const named = ranked.map((name) => ({ name, color: OWNER_COLORS[ownerSlot.get(name)!] }));
  // the shared row only when there is an owner without a row of its own
  const fields = counts.size > named.length ? [...named, { name: OTHER_OWNERS, color: OWNER_OTHER }] : named;
  const rows = JSON.stringify(fields);
  if (rows === ownerRows) return false;
  ownerRows = rows;
  const hasOwner = ['all', ['has', OWNER], ['!=', ['get', OWNER], ''], ['!=', ['get', OWNER], PRIVATE]];
  dynamic.set(OWNER, {
    rule: {
      filter: hasOwner, sourceFilter: hasOwner, source: 'buildings',
      // a match needs at least one branch; an owner it does not name gets the shared colour
      color: named.length ? ['match', ['get', OWNER], ...named.flatMap((f) => [f.name, f.color]), OWNER_OTHER] : OWNER_OTHER,
    },
    legend: { name: 'Eigendom', fields },
    strip: [...OWNER_COLORS, OWNER_OTHER].map((c) => parseColor(c)!),
  });
  for (const key of compiled.keys()) if (key.endsWith(`:${OWNER}`)) compiled.delete(key);
  return true;
}
// the layer exists before any building is loaded: a mapset's layer set and the layer list ask for it
updateOwners([]);

/**
 * The themes of a mapset: one per layer of its layer set, in its order and under its names. Building layers colour the
 * buildings, area layers draw on the ground; the building blocks have their own switch and a layer this map does not
 * know (a retired one) is left out. With the foundation types and the recovery layer together, a first theme shows
 * them at once, as switching them all on does in the current map app.
 */
export function mapsetThemes(group: string, layers: { id: string; name: string }[]): Theme[] {
  const areas = AREA_LAYERS as Record<string, unknown>;
  const themes: Theme[] = [];
  for (const l of layers) {
    if (l.id === 'building-cluster') continue;
    if (ruleOf(l.id)) themes.push({ id: l.id, group, name: l.name, layers: [l.id] });
    else if (areas[l.id]) themes.push({ id: l.id, group, name: l.name, layers: [], area: l.id });
  }
  const types = FOUNDATION_TYPES.filter((id) => layers.some((l) => l.id === id));
  const recovery = layers.find((l) => l.id === 'foundation-recovery');
  if (types.length && recovery) {
    const typeName = layers.find((l) => l.id === types[0])!.name;
    themes.unshift({
      id: 'foundation', group, name: `${typeName} en ${recovery.name.toLowerCase()}`,
      layers: ['foundation-recovery', ...types],
      sections: [
        { title: typeName, legend: types[0], layers: types },
        { title: recovery.name, legend: 'foundation-recovery', layers: ['foundation-recovery'] },
      ],
    });
  }
  return themes;
}

function compile(id: string, palette: PaletteName): Compiled {
  const key = `${palette}:${id}`;
  let c = compiled.get(key);
  if (c) return c;
  const rule = ruleOf(id);
  const rows = legendOf(id).fields;
  const map = remap(id, rows, palette);
  const colorExpr = map ? recolorExpression(rule.color, map) : rule.color;
  const color = expression.createPropertyExpression(colorExpr, 'fill-extrusion-color', COLOR_SPEC);
  if (color.result !== 'success') throw new Error(`rule ${id} does not parse`);
  const input = Array.isArray(rule.color) && rule.color[0] === 'interpolate' ? rule.color[2] : null;
  c = {
    filter: rule.filter ? featureFilter(rule.filter, 'layers[0].filter').filter : () => true,
    color: color.value as Compiled['color'],
    interpolatedOn: Array.isArray(input) && input[0] === 'get' ? input[1] : null,
    props: [...referenced(rule.color, referenced(rule.filter, new Set()))],
    legend: rows.map((r) => {
      const old = parseColor('#' + r.color.replace('#', ''))!;
      return { name: r.name, color: map?.get(old) ?? old };
    }),
  };
  compiled.set(key, c);
  return c;
}

/**
 * The value range a legend row names, e.g. "< 1960", "1960 t/m 1970", "> € 200.000", "0,0 t/m -0,5 mm/jaar".
 * Dutch numbers: '.' groups thousands, ',' is the decimal mark.
 */
export function legendRange(name: string): [number, number, boolean, boolean] | null {
  const numbers = [...name.matchAll(/-?\d[\d.]*(?:,\d+)?/g)].map((m) => Number(m[0].replace(/\./g, '').replace(',', '.')));
  if (name.includes('t/m') && numbers.length === 2) return [Math.min(...numbers), Math.max(...numbers), true, true];
  if (name.trim().startsWith('<') && numbers.length === 1) return [-Infinity, numbers[0], false, false];
  if (name.trim().startsWith('>') && numbers.length === 1) return [numbers[0], Infinity, false, false];
  return null;
}

/** a layer's filter and colour as MapLibre expressions (in the chosen palette): the flat map draws them as they are */
export function layerStyle(id: string, palette: PaletteName): { filter: unknown; color: unknown; source: string } {
  const rule = ruleOf(id);
  const map = remap(id, legendOf(id).fields, palette);
  // on its own tiles a layer draws as in the current map app: its own source and its original filter
  return { filter: rule.sourceFilter, color: map ? recolorExpression(rule.color, map) : rule.color, source: rule.source };
}

/** legend colours of a theme's first section, for the little colour strip next to its name */
export function legendColors(theme: Theme, palette: PaletteName): number[] {
  if (theme.area) return legendRows(theme.area).map((r) => r.color);
  const id = theme.sections?.[0].legend ?? theme.layers[0];
  return dynamic.get(id)?.strip ?? compile(id, palette).legend.map((r) => r.color);
}

/** the database legend of any layer (also the area layers, which colour no buildings): name + colour per row */
export function legendRows(id: string): { name: string; color: number }[] {
  return (legendOf(id)?.fields ?? []).map((r) => ({ name: r.name, color: parseColor('#' + r.color.replace('#', '')) ?? 0x888888 }));
}

/** the title of a layer's database legend */
export const legendTitle = (id: string) => legendOf(id)?.name ?? id;

export interface LegendRow { name: string; color: number; count: number }
export interface LegendSection { title: string; rows: LegendRow[]; other: number }
export interface ThemeResult {
  colors: Int32Array;
  /** legend row per building: section * 256 + row, -1 = not drawn, -2 = drawn but in no row ("Overig") */
  rows: Int32Array;
  /** legend sections without counts; counts come from countLegend for a range of buildings (one city) */
  sections: LegendSection[];
}

const MISSING = '\u0000';

export function evaluateTheme(theme: Theme, buildings: Props[], palette: PaletteName): ThemeResult {
  const sectionDefs = theme.sections ?? theme.layers.map((id) => ({ title: legendOf(id).name, legend: id, layers: [id] }));
  const sections: LegendSection[] = sectionDefs.map((s) => ({
    title: s.title,
    rows: compile(s.legend, palette).legend.map((r) => ({ ...r, count: 0 })),
    other: 0,
  }));
  const sectionOf = new Map<string, number>();
  sectionDefs.forEach((s, i) => s.layers.forEach((l) => sectionOf.set(l, i)));
  // value ranges per section, only when every row names one
  const ranges = sections.map((s) => {
    const r = s.rows.map((row) => legendRange(row.name));
    return r.every(Boolean) ? (r as [number, number, boolean, boolean][]) : null;
  });
  const inRange = ([lo, hi, loIn, hiIn]: [number, number, boolean, boolean], v: number) =>
    (loIn ? v >= lo : v > lo) && (hiIn ? v <= hi : v < hi);

  // one answer per layer and distinct combination of the properties it reads: [colour, row] or null (not drawn)
  const layers = theme.layers.map((id) => ({ id, ...compile(id, palette) }));
  const globals = { zoom: 16 };
  const answer = (layer: (typeof layers)[number], props: Props): [number, number] | null => {
    const feature = { type: 'Polygon', properties: props };
    if (!layer.filter(globals, feature)) return null;
    const c = layer.color.evaluate(globals, feature);
    if (!c || c.a < 0.01) return null; // fully transparent = not drawn in 2D either
    // style-spec colours are premultiplied
    const rgb = (Math.round((c.r / c.a) * 255) << 16) | (Math.round((c.g / c.a) * 255) << 8) | Math.round((c.b / c.a) * 255);
    const s = sectionOf.get(layer.id) ?? 0;
    const value = layer.interpolatedOn ? props[layer.interpolatedOn] : undefined;
    let best = -1;
    if (ranges[s] && typeof value === 'number') {
      // gradients draw in-between colours: count by value in the range the legend row names
      best = ranges[s]!.findIndex((r) => inRange(r, value));
    } else {
      let bestDistance = Infinity;
      sections[s].rows.forEach((r, k) => { const d = colorDistance(r.color, rgb); if (d < bestDistance) { bestDistance = d; best = k; } });
      if (bestDistance > 12) best = -1;
    }
    return [rgb, best >= 0 ? s * 256 + best : -2];
  };

  // one key per building over every property the theme's layers read; the first layer that draws wins
  const props = [...new Set(layers.flatMap((l) => l.props))];
  const memo = new Map<string, [number, number] | null>();
  const colors = new Int32Array(buildings.length).fill(NONE);
  const rows = new Int32Array(buildings.length).fill(-1);
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    let key = '';
    for (const p of props) key += (b[p] ?? MISSING) + '\u0001';
    let a = memo.get(key);
    if (a === undefined) {
      a = null;
      for (const layer of layers) if ((a = answer(layer, b))) break;
      memo.set(key, a);
    }
    if (!a) continue;
    colors[i] = a[0];
    rows[i] = a[1];
  }
  return { colors, rows, sections };
}

/** legend with counts for buildings [from, to) — one city */
export function countLegend(result: ThemeResult, from: number, to: number): { sections: LegendSection[]; none: number } {
  const sections = result.sections.map((s) => ({ title: s.title, rows: s.rows.map((r) => ({ ...r, count: 0 })), other: 0 }));
  let none = 0;
  for (let i = from; i < to; i++) {
    const r = result.rows[i];
    if (r === -1) none++;
    else if (r === -2) {
      // "Overig" belongs to the section of the layer that drew it; the colour tells which one is unknown here
      sections[0].other++;
    } else sections[r >> 8].rows[r & 255].count++;
  }
  return { sections, none };
}
