// Colour palettes. 'current' = exactly what the live map draws (WebFront rules + DB legends).
// '2026' = a refined palette with the same classes and order, mapped row by row onto each DB legend; the same
// substitution is applied to the drawing rules, so legend, counts and drawing stay consistent.
export type PaletteName = '2026' | 'current';

const RISK = ['#30A46C', '#99D52A', '#FFC53D', '#F76B15', '#E5484D'];
const FOUNDATION: Record<string, string> = {
  'Houten paal': '#A1462A',
  'Houten paal met oplanger': '#DC9B2F',
  'Betonnen of stalen paal': '#9DAAC0',
  'Ondiepe fundering': '#E5484D',
  Gecombineerd: '#8E4EC6',
  Overig: '#EAC54F',
};
const CATEGORICAL = ['#3E63DD', '#12A594', '#F76B15', '#D6409F', '#8E4EC6', '#30A46C', '#E5484D', '#0090FF',
  '#FFC53D', '#AB4ABA', '#99D52A', '#E54666', '#00A2C7', '#C2A499', '#5B5BD6', '#BDA56E'];

/** per layer: new colour per DB legend row, by row name or in row order */
const P2026: Record<string, Record<string, string> | string[]> = {
  'foundation-type-established': FOUNDATION,
  'foundation-type-cluster': FOUNDATION,
  'foundation-type-indicative': FOUNDATION,
  'foundation-recovery': ['#30A46C', '#12A594', '#8E4EC6', '#E5794A', '#5B5BD6'],
  velocity: ['#EEF1F8', '#D2DCF2', '#ABBEEA', '#7E9BE0', '#5774D3', '#3E52B8', '#2A2F7F'],
  'construction-year': ['#3B2A6B', '#3F4A8A', '#376A9B', '#2E8A9E', '#2BA88F', '#5DC26E', '#A8D54B', '#F1E04B'],
  'unclassified-risk': RISK,
  'drystand-risk': RISK,
  'dewatering-depth-risk': RISK,
  'bio-infection-risk': RISK,
  hotspot: [RISK[3], RISK[4]],
  'restoration-cost': ['#FFF6E5', '#FDE7C1', '#FBD199', '#F7B26E', '#F08F4E', '#E06A3B', '#C64A33', '#9E322F', '#6E2129'],
  'inquiry-type': CATEGORICAL,
  'damage-cause': CATEGORICAL,
  'overall-quality': ['#30A46C', '#8BC34A', '#D4CE3A', '#F2B035', '#E57A35', '#C2412D'],
  'enforcement-term': ['#0F7B5F', '#1F9573', '#36AE86', '#62C49B', '#97D8B5', '#CBEBD3', '#FBE3C2', '#F6C08E', '#EF9A62',
    '#E2713F', '#C64B31', '#9C2B26'],
  monitoring: ['#D6409F'],
};

/** packed 0xRRGGBB from '#rgb', '#rrggbb', 'rgb()/rgba()', 'hsl()/hsla()'; null for anything else (property names, enum values) */
export function parseColor(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return parseInt(h, 16);
  }
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(t);
  if (m) return (Math.round(+m[1]) << 16) | (Math.round(+m[2]) << 8) | Math.round(+m[3]);
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[ ,]+([\d.]+)%[ ,]+([\d.]+)%/.exec(t);
  if (m) {
    const h = +m[1] / 360, sat = +m[2] / 100, l = +m[3] / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const ch = (x: number) => {
      x = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
      const v = x < 1 / 6 ? p + (q - p) * 6 * x : x < 1 / 2 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p;
      return Math.round(v * 255);
    };
    return (ch(h + 1 / 3) << 16) | (ch(h) << 8) | ch(h - 1 / 3);
  }
  return null;
}

export const toHex = (c: number) => '#' + c.toString(16).padStart(6, '0');
export const colorDistance = (a: number, b: number) =>
  Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));

/** old legend colour -> new colour for one layer, or null for the current palette */
export function remap(layer: string, legend: { name: string; color: string }[], palette: PaletteName): Map<number, number> | null {
  if (palette === 'current') return null;
  const def = P2026[layer];
  if (!def) return null;
  const map = new Map<number, number>();
  legend.forEach((row, i) => {
    const next = Array.isArray(def) ? def[i % def.length] : def[row.name];
    const old = parseColor('#' + row.color.replace('#', ''));
    if (next && old !== null) map.set(old, parseColor(next)!);
  });
  return map;
}

/** the closest key within tolerance, so 'hsl(116, 100%, 60%)' in a rule finds legend row 42FF33 */
export function lookup(map: Map<number, number>, color: number, tolerance = 18): number | null {
  let best: number | null = null, bestDistance = Infinity;
  for (const [old, next] of map) {
    const d = colorDistance(old, color);
    if (d < bestDistance) { bestDistance = d; best = next; }
  }
  return bestDistance <= tolerance ? best : null;
}

/** copy of a style expression with every colour literal swapped through the map */
export function recolorExpression(expr: unknown, map: Map<number, number>): unknown {
  if (Array.isArray(expr)) return expr.map((e) => recolorExpression(e, map));
  const c = parseColor(expr);
  if (c === null) return expr;
  const next = lookup(map, c);
  return next === null ? expr : toHex(next);
}
