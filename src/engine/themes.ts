// Map themes: the live map app's drawing rules (WebFront src/config/layers/*.json, frozen in rules.json) evaluated
// per building with MapLibre's own style-spec engine, so every building gets exactly the colour the 2D map draws.
// Legends are the DB rows (application.mapset_layer.fields, frozen in legends.json). The '2026' palette swaps
// colours in both, row by row (palette.ts).
import { expression, featureFilter, latest } from '@maplibre/maplibre-gl-style-spec';
import RULES from './rules.json';
import LEGENDS from './legends.json';
import { colorDistance, parseColor, recolorExpression, remap, type PaletteName } from './palette';

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
}

const FOUNDATION_TYPES = ['foundation-type-established', 'foundation-type-cluster', 'foundation-type-indicative'];

export const GROUPS = ['Fundering', 'Pand', 'Risico', 'Rapportage'];

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
const legendOf = (id: string) => (LEGENDS as Record<string, { name: string; fields: { name: string; color: string }[] }>)[id];

function compile(id: string, palette: PaletteName): Compiled {
  const key = `${palette}:${id}`;
  let c = compiled.get(key);
  if (c) return c;
  const rule = (RULES as Record<string, any>)[id];
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

/** legend colours of a theme's first section, for the little colour strip next to its name */
export function legendColors(theme: Theme, palette: PaletteName): number[] {
  const id = theme.sections?.[0].legend ?? theme.layers[0];
  return compile(id, palette).legend.map((r) => r.color);
}

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
