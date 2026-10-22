// Restyles our basemap (tiles.fundermaps.com/style/fundermaps-basemap, OpenMapTiles schema) into a quiet light or dark
// canvas for 3D data: muted land and water, white or graphite streets, no shields, house numbers or admin lines.
import type { Map as MapLibreMap } from 'maplibre-gl';

export type Mode = 'light' | 'dark';

export interface Look {
  bg: string; land: string; water: string; waterLabel: string; park: string; wood: string;
  road: string; roadMinor: string; casing: string; rail: string; aeroway: string;
  label: string; place: string; halo: string;
  sky: string; horizon: string;
  /** mask outside the city */
  mask: string; maskOpacity: number;
  accent: string;
}

export const LOOKS: Record<Mode, Look> = {
  light: {
    bg: '#F3F1EC', land: '#EFECE6', water: '#BCD3E6', waterLabel: '#45698A', park: '#DCE5D0', wood: '#D2DEC5',
    road: '#FFFFFF', roadMinor: '#FBFAF8', casing: '#E3DED4', rail: '#D6D1C7', aeroway: '#E6E3DD',
    label: '#6A717C', place: '#2B313A', halo: 'rgba(255,255,255,0.92)',
    sky: '#D7E4F1', horizon: '#F3F1EC',
    mask: '#F3F1EC', maskOpacity: 0.55,
    accent: '#3E63DD',
  },
  dark: {
    bg: '#12161C', land: '#151A21', water: '#0D2234', waterLabel: '#7095B5', park: '#16231D', wood: '#172A20',
    road: '#2B323C', roadMinor: '#222831', casing: '#1A1F26', rail: '#2C333D', aeroway: '#1C2128',
    label: '#8B95A3', place: '#DDE3EA', halo: 'rgba(18,22,28,0.92)',
    sky: '#0A0E14', horizon: '#1A2230',
    mask: '#12161C', maskOpacity: 0.6,
    accent: '#7C9BFF',
  },
};

/** basemap layers the map does without: the old map's own buildings and boundaries, house numbers, shields, … */
const HIDDEN = /^(building|housenumber|airport|boundary_|fundermaps-|highway-shield|road_shield|landcover_ice|landcover_glacier)/;

type Paint = [layer: string, property: string, value: unknown];

/** the paint changes of one look, for the basemap layers of the style (our own layers are left alone) */
function paints(layers: { id: string; type: string }[], mode: Mode): Paint[] {
  const l = LOOKS[mode];
  const out: Paint[] = [];
  for (const { id, type } of layers) {
    if (HIDDEN.test(id) || id === 'bag3d' || id.startsWith('fm-') || id === 'selection-ring') continue;
    if (type === 'background') out.push([id, 'background-color', l.bg]);
    else if (id === 'water') out.push([id, 'fill-color', l.water]);
    else if (id === 'waterway') out.push([id, 'line-color', l.water]);
    else if (id === 'park') out.push([id, 'fill-color', l.park], [id, 'fill-opacity', 0.9]);
    else if (id === 'landcover_wood') out.push([id, 'fill-color', l.wood]);
    else if (id === 'landuse_residential') out.push([id, 'fill-color', l.land], [id, 'fill-opacity', 0.7]);
    else if (id.startsWith('aeroway')) out.push([id, type === 'fill' ? 'fill-color' : 'line-color', l.aeroway]);
    else if (id.startsWith('railway')) out.push([id, 'line-color', id.endsWith('dashline') ? l.bg : l.rail]);
    else if (id.endsWith('_casing')) out.push([id, 'line-color', l.casing]);
    else if (id === 'road_area_pier') out.push([id, 'fill-color', l.roadMinor]);
    else if (/^(highway_|tunnel_|road_)/.test(id) && type === 'line') {
      out.push([id, 'line-color', /minor|path|pier|subtle/.test(id) ? l.roadMinor : l.road], [id, 'line-opacity', 1]);
    } else if (type === 'symbol') {
      const water = /water/.test(id);
      out.push(
        [id, 'text-color', water ? l.waterLabel : id.startsWith('label_') ? l.place : l.label],
        [id, 'text-halo-color', l.halo], [id, 'text-halo-width', 1.4], [id, 'text-halo-blur', 0.4],
      );
    }
  }
  return out;
}

function sky(mode: Mode) {
  const l = LOOKS[mode];
  return {
    'sky-color': l.sky, 'horizon-color': l.horizon, 'fog-color': l.horizon,
    'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.7, 'atmosphere-blend': 0,
  };
}

/**
 * The basemap style as the map should first draw it: the hidden layers and the sources only they used are gone and the
 * look is applied, so the original basemap (with the old map's buildings and lines) never shows while the map loads.
 */
export function prepareStyle(style: any, mode: Mode): any {
  const out = structuredClone(style);
  out.layers = out.layers.filter((l: { id: string }) => !HIDDEN.test(l.id));
  const used = new Set(out.layers.map((l: { source?: string }) => l.source).filter(Boolean));
  for (const name of Object.keys(out.sources)) if (!used.has(name)) delete out.sources[name];
  const byId = new Map<string, any>(out.layers.map((l: { id: string }) => [l.id, l]));
  for (const [id, prop, value] of paints(out.layers, mode)) {
    const layer = byId.get(id);
    (layer.paint ??= {})[prop] = value;
  }
  out.sky = sky(mode);
  return out;
}

/** switch a running map to the other look (the light/dark button) */
export function restyle(map: MapLibreMap, mode: Mode) {
  const layers = map.getStyle().layers;
  for (const { id } of layers) if (HIDDEN.test(id)) map.setLayoutProperty(id, 'visibility', 'none');
  for (const [id, prop, value] of paints(layers, mode)) map.setPaintProperty(id, prop as any, value as any);
  map.setSky(sky(mode));
}
