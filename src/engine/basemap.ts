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

const HIDDEN = /^(building|housenumber|airport|boundary_|fundermaps-|highway-shield|road_shield|landcover_ice|landcover_glacier)/;

export function restyle(map: MapLibreMap, mode: Mode) {
  const l = LOOKS[mode];
  const paint = (id: string, prop: string, value: unknown) => map.setPaintProperty(id, prop as any, value as any);
  for (const layer of map.getStyle().layers) {
    const { id, type } = layer;
    if (id.startsWith('city-') || id === 'bag3d') continue;
    if (HIDDEN.test(id)) { map.setLayoutProperty(id, 'visibility', 'none'); continue; }
    if (type === 'background') paint(id, 'background-color', l.bg);
    else if (id === 'water') paint(id, 'fill-color', l.water);
    else if (id === 'waterway') paint(id, 'line-color', l.water);
    else if (id === 'park') { paint(id, 'fill-color', l.park); paint(id, 'fill-opacity', 0.9); }
    else if (id === 'landcover_wood') paint(id, 'fill-color', l.wood);
    else if (id === 'landuse_residential') { paint(id, 'fill-color', l.land); paint(id, 'fill-opacity', 0.7); }
    else if (id.startsWith('aeroway')) paint(id, type === 'fill' ? 'fill-color' : 'line-color', l.aeroway);
    else if (id.startsWith('railway')) paint(id, 'line-color', id.endsWith('dashline') ? l.bg : l.rail);
    else if (id.endsWith('_casing')) paint(id, 'line-color', l.casing);
    else if (id === 'road_area_pier') paint(id, 'fill-color', l.roadMinor);
    else if (/^(highway_|tunnel_|road_)/.test(id) && type === 'line') {
      paint(id, 'line-color', /minor|path|pier|subtle/.test(id) ? l.roadMinor : l.road);
      paint(id, 'line-opacity', 1);
    } else if (type === 'symbol') {
      const water = /water/.test(id);
      paint(id, 'text-color', water ? l.waterLabel : id.startsWith('label_') ? l.place : l.label);
      paint(id, 'text-halo-color', l.halo);
      paint(id, 'text-halo-width', 1.4);
      paint(id, 'text-halo-blur', 0.4);
    }
  }
  if (map.getLayer('city-mask')) {
    paint('city-mask', 'fill-color', l.mask);
    paint('city-mask', 'fill-opacity', l.maskOpacity);
    paint('city-glow', 'line-color', l.accent);
    paint('city-line', 'line-color', l.accent);
  }
  map.setSky({
    'sky-color': l.sky,
    'horizon-color': l.horizon,
    'fog-color': l.horizon,
    'sky-horizon-blend': 0.7,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.7,
    'atmosphere-blend': 0,
  });
}
