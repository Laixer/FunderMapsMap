// The map: MapLibre draws the basemap, labels and controls; three.js draws the 3D BAG buildings in a custom layer
// (engine/scene.ts); every building is coloured by the live map app's rules from our own `buildings` tiles. This class
// owns everything heavy (not reactive) and writes a small, plain UI state that the Vue components render.
import { Map as MapLibreMap, NavigationControl, ScaleControl, GeolocateControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// MapLibre 6 looks for its worker as `maplibre-gl-worker.mjs` next to its own file, a name the bundler cannot see, so
// the worker never ends up in the build ("Worker failed to load"). Ship it as an asset and say where it is.
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { makeFrame, type Frame, type TileFeature } from '@/engine/tiles';
import { TileWorkers } from '@/engine/workers';
import { BuildingLayer, type Mode, type TileView } from '@/engine/scene';
import { restyle, LOOKS } from '@/engine/basemap';
import { GROUPS, THEMES, NONE, countLegend, evaluateTheme, layerStyle, legendColors, type Theme, type ThemeResult } from '@/engine/themes';
import { toHex, type PaletteName } from '@/engine/palette';
import * as L from '@/engine/labels';
import { BuildingData, type Props } from '@/data/building-data';
import { buildingInfo, type BuildingInfo } from '@/search/search';
import { Bag3dTileset, type LeafTile } from '@/engine/bag3d-tileset';
import { BAG3D, BASEMAP, TILESERVER } from '@/config';

setWorkerUrl(maplibreWorker);

// ---- UI state (plain data, made reactive by the caller) ------------------------------------------------------------
export interface LegendRowView { color: string; name: string; count: string; width: number; empty: boolean }
export interface UiState {
  mode: Mode;
  palette: PaletteName;
  groups: string[];
  group: string;
  themeId: string;
  layers: { id: string; name: string; ramp: string }[];
  lines: boolean;
  shadows: boolean;
  context: boolean;
  legend: { title: string; total: string; note: string; sections: { title: string; rows: LegendRowView[] }[]; message: string };
  status: { text: string; busy: boolean };
  tooltip: null | { x: number; y: number; title: string; more: string; swatch: string; valueTitle: string; valueLabel: string; facts: [string, string][] };
  info: null | {
    eyebrow: string; title: string; sub: string; swatch: string; valueTitle: string; valueLabel: string;
    stats: [string, string][]; rows: [string, string][]; bag: [string, string][]; id: string; hasData: boolean;
  };
}

export function initialUi(): UiState {
  return {
    mode: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    palette: store.get('fm-palette') === 'current' ? 'current' : '2026',
    groups: GROUPS, group: THEMES[0].group, themeId: THEMES[0].id, layers: [],
    lines: store.get('fm-lines') !== 'off', shadows: true, context: true,
    legend: { title: '', total: '', note: '', sections: [], message: 'Gegevens laden…' },
    status: { text: 'Laden…', busy: true },
    tooltip: null, info: null,
  };
}

// ---- constants ------------------------------------------------------------------------------------------------------
const START = { center: [4.4655, 51.9145] as [number, number], zoom: 15.5, pitch: 66, bearing: 72 };
const MIN_ZOOM_3D = 13.5;
/** load 3D tiles up to this many metres from the view centre: the far horizon of a tilted view stays empty */
const tileDistance = (zoom: number) => Math.min(4500, Math.max(1200, 2200 * 2 ** (16 - zoom)));
/** at most this many 3D tiles in memory; the farthest go first */
const MAX_TILES = 40;
/** past this distance from the frame origin the scene starts over around the view (keeps float32 metres small) */
const REFRAME_METRES = 40000;
const NEUTRAL: Record<Mode, { noData: number; context: number }> = {
  light: { noData: 0xdcdfe4, context: 0xeeeff1 },
  dark: { noData: 0x4a525d, context: 0x2b313a },
};
const ATTRIBUTION = '3D-panden <a href="https://3dbag.nl" target="_blank" rel="noopener">3DBAG</a> (TU Delft 3D geoinformation, 3DGI), CC BY 4.0 · Gegevens FunderMaps';

const nf = new Intl.NumberFormat('nl-NL');
const nf1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

interface TileEntry {
  uri: string;
  bounds: number[];
  state: 'loading' | 'ready' | 'error';
  view?: TileView;
  /** building index (BuildingData.buildings) per feature, -1 = no FunderMaps data (yet) */
  featureBuilding?: Int32Array;
}
type Hit = { view: TileView; feature: number };

function metres(a: [number, number], b: [number, number]): number {
  const dx = (a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110540;
  return Math.hypot(dx, dy);
}

/** metres from the view centre to the nearest point of a tile */
function distanceTo(bounds: number[], c: { lng: number; lat: number }): number {
  const cx = Math.min(Math.max(c.lng, bounds[0]), bounds[2]);
  const cy = Math.min(Math.max(c.lat, bounds[1]), bounds[3]);
  return metres([c.lng, c.lat], [cx, cy]);
}

function ramp(colors: number[]): string {
  const step = 100 / colors.length;
  return `linear-gradient(90deg, ${colors.map((c, i) => `${toHex(c)} ${(i * step).toFixed(1)}% ${((i + 1) * step).toFixed(1)}%`).join(', ')})`;
}

function fmt(value: unknown, labels?: Record<string, string>): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (labels) return labels[String(value)] ?? String(value);
  return String(value);
}

// ---- the controller --------------------------------------------------------------------------------------------------
export class MapController {
  map: MapLibreMap;
  private frame: Frame;
  private layer: BuildingLayer;
  private workers = new TileWorkers(2);
  private data: BuildingData;
  private tileset = new Bag3dTileset(BAG3D);
  /** the 3D BAG leaf tiles of the last walk, by uri */
  private leaves = new Map<string, LeafTile>();
  private walkSeq = 0;
  private walkError = false;
  private walking = false;
  private entries = new Map<string, TileEntry>();
  private entryOfView = new Map<TileView, TileEntry>();
  private queue: string[] = [];
  private active = 0;
  private theme: Theme = THEMES[0];
  private result: ThemeResult | null = null;
  private selected: Hit | null = null;
  private hovered: Hit | null = null;
  /** pand to select once its tile has loaded (after a search) */
  private pendingSelect: string | null = null;
  private infoFor: string | null = null;
  private infoAbort: AbortController | null = null;
  private place: BuildingInfo | null = null;
  private themeTimer = 0;
  private hoverFrame = 0;
  /**
   * Flat mode: our own `buildings` tiles drawn as blocks with the live map's rules (MapLibre fill-extrusion), when 3D
   * BAG cannot be reached (on 2026-10-21 it could not, from anywhere we tested). Back to 3D as soon as it answers.
   */
  private flat = false;
  private flatLayers: string[] = [];
  private flatSelected: { id: string; props: Props } | null = null;

  constructor(container: HTMLElement, private ui: UiState) {
    const intro = location.hash.length <= 1;
    this.frame = makeFrame(START.center[0], START.center[1]);
    this.layer = new BuildingLayer(this.frame);
    this.data = new BuildingData(TILESERVER, () => this.onData());
    this.map = new MapLibreMap({
      container,
      style: BASEMAP,
      center: START.center,
      zoom: intro ? 15.1 : START.zoom,
      pitch: intro ? 38 : START.pitch,
      bearing: intro ? -6 : START.bearing,
      maxPitch: 78,
      hash: true,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true, customAttribution: ATTRIBUTION },
    });
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
    this.map.addControl(new ScaleControl({ maxWidth: 110 }), 'bottom-right');
    this.layer.lines = ui.lines;
    this.renderLayers();
    this.renderLegend();

    this.map.on('load', () => {
      const firstSymbol = this.firstSymbol();
      this.map.addSource('selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      this.map.addLayer({
        id: 'selection-ring', type: 'circle', source: 'selection',
        paint: { 'circle-pitch-alignment': 'map', 'circle-color': '#3E63DD', 'circle-opacity': 0.08, 'circle-stroke-color': '#3E63DD', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.6, 'circle-radius': 0 },
      }, firstSymbol);
      this.map.addLayer(this.layer, firstSymbol);
      // flat mode: our own building tiles (layers added by renderFlat) and the outline of a building picked there
      this.map.addSource('fm', { type: 'vector', url: `${TILESERVER}/buildings` });
      this.map.addLayer({
        id: 'fm-flat-selected', type: 'line', source: 'fm', 'source-layer': 'buildings', minzoom: 13,
        filter: ['==', ['get', 'building_id'], ''], paint: { 'line-color': LOOKS[ui.mode].accent, 'line-width': 3 },
      }, firstSymbol);
      // without a GPU the shadow pass costs seconds per frame: start with shadows off there (?shadows=on forces them)
      const forced = new URLSearchParams(location.search).get('shadows');
      this.layer.shadows = forced ? forced === 'on' : !this.layer.software;
      ui.shadows = this.layer.shadows;
      this.applyMode(false);
      if (intro) this.map.easeTo({ ...START, duration: 3200, easing: (t) => 1 - Math.pow(1 - t, 3) });
      else this.onMoveEnd();
    });
    this.map.on('moveend', () => this.onMoveEnd());
    this.map.on('mousemove', (e) => {
      if (this.hoverFrame) return;
      this.hoverFrame = requestAnimationFrame(() => {
        this.hoverFrame = 0;
        if (this.flat) {
          const p = this.flatAt(e.point.x, e.point.y);
          this.map.getCanvas().style.cursor = p ? 'pointer' : '';
          if (!p) { this.ui.tooltip = null; return; }
          const id = String(p.building_id).slice(-16);
          const b = this.data.index.get(id) ?? -1;
          this.tooltipFor(b, b >= 0 ? this.data.buildings[b] : p, null, e.point.x, e.point.y);
          return;
        }
        const hit = this.layer.pick(e.point.x, e.point.y, this.visible);
        this.setHover(hit);
        this.renderTooltip(hit, e.point.x, e.point.y);
      });
    });
    this.map.on('mouseout', () => { this.setHover(null); this.renderTooltip(null, 0, 0); });
    this.map.on('movestart', () => this.renderTooltip(null, 0, 0));
    this.map.on('click', (e) => {
      if (!this.flat) return this.select(this.layer.pick(e.point.x, e.point.y, this.visible));
      const p = this.flatAt(e.point.x, e.point.y);
      this.selectFlat(p ? { id: String(p.building_id).slice(-16), props: p } : null);
    });
    if (location.search.includes('debug')) Object.assign(window as any, { __pick: (x: number, y: number) => this.layer.pick(x, y, this.visible), __layer: this.layer, __ctl: this });
  }

  private firstSymbol() {
    return this.map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  }

  // ---- view changes -------------------------------------------------------------------------------------------------
  private onMoveEnd() {
    const c = this.map.getCenter();
    if (metres([c.lng, c.lat], [this.frame.lon, this.frame.lat]) > REFRAME_METRES) this.reframe(c.lng, c.lat);
    if (this.map.getZoom() >= MIN_ZOOM_3D) {
      const b = this.map.getBounds();
      this.data.update([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [c.lng, c.lat]);
    }
    this.updateTiles();
  }

  /** start the 3D scene over around a new origin (far across the country) */
  private reframe(lon: number, lat: number) {
    this.select(null);
    this.setHover(null);
    this.queue.length = 0;
    for (const e of this.entries.values()) if (e.view) this.layer.removeTile(e.view);
    this.entries.clear();
    this.entryOfView.clear();
    this.frame = makeFrame(lon, lat);
    const lines = this.layer.lines, shadows = this.layer.shadows;
    this.map.removeLayer(this.layer.id);
    this.layer = new BuildingLayer(this.frame);
    this.layer.lines = lines;
    this.layer.shadows = shadows;
    this.map.addLayer(this.layer, this.firstSymbol());
    this.layer.setMode(this.ui.mode);
  }

  // ---- 3D tiles -----------------------------------------------------------------------------------------------------
  private async updateTiles() {
    if (!this.map.getLayer(this.layer.id)) return this.renderStatus();
    if (this.map.getZoom() < MIN_ZOOM_3D) return this.renderStatus();
    const view = this.map.getBounds();
    const seq = ++this.walkSeq;
    let found: LeafTile[];
    this.walking = true;
    this.renderStatus();
    try {
      found = await this.tileset.leaves([view.getWest(), view.getSouth(), view.getEast(), view.getNorth()]);
      this.walkError = false;
      if (this.flat) this.setFlat(false);
    } catch (err) {
      console.error(err);
      this.walkError = true;
      if (!this.flat) this.setFlat(true);
      return this.renderStatus();
    } finally {
      if (seq === this.walkSeq) this.walking = false;
    }
    // a newer view change already asked again
    if (seq !== this.walkSeq) return;
    for (const t of found) this.leaves.set(t[0], t);
    const c = this.map.getCenter();
    const limit = tileDistance(this.map.getZoom());
    const wanted = found
      .map((t) => ({ t, d: distanceTo(t.slice(1) as number[], c) }))
      .filter((x) => x.d < limit)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_TILES);
    this.queue.length = 0;
    for (const { t } of wanted) if (!this.entries.has(t[0])) this.queue.push(t[0]);
    this.evict(new Set(wanted.map((w) => w.t[0])));
    this.pump();
    this.renderStatus();
  }

  private evict(wanted: Set<string>) {
    const room = MAX_TILES - this.queue.length;
    if (this.entries.size <= room) return;
    const c = this.map.getCenter();
    const spare = [...this.entries.values()]
      .filter((e) => e.state === 'ready' && !wanted.has(e.uri) && e.view !== this.selected?.view)
      .sort((a, b) => distanceTo(b.bounds, c) - distanceTo(a.bounds, c));
    for (const e of spare.slice(0, this.entries.size - room)) {
      if (e.view === this.hovered?.view) this.setHover(null);
      this.layer.removeTile(e.view!);
      this.entryOfView.delete(e.view!);
      this.entries.delete(e.uri);
    }
  }

  private pump() {
    while (this.active < 4 && this.queue.length) {
      const uri = this.queue.shift()!;
      const t = this.leaves.get(uri);
      if (this.entries.has(uri) || !t) continue;
      const { done } = this.workers.request(this.tileset.base + uri, this.frame);
      const entry: TileEntry = { uri, bounds: t.slice(1) as number[], state: 'loading' };
      const layer = this.layer;
      this.entries.set(uri, entry);
      this.active++;
      done
        .then((tile) => {
          if (this.entries.get(uri) !== entry || layer !== this.layer) return;
          entry.state = 'ready';
          entry.view = this.layer.addTile(tile, new Uint8Array(tile.features.length * 4));
          this.entryOfView.set(entry.view, entry);
          this.linkFeatures(entry);
          this.layer.setColors(entry.view, this.tileColors(entry), false);
          this.trySelectPending(entry);
        })
        .catch((err) => {
          if (String(err).includes('aborted')) return;
          console.error(err);
          entry.state = 'error';
        })
        .finally(() => {
          this.active--;
          this.pump();
          this.renderStatus();
        });
    }
  }

  private linkFeatures(entry: TileEntry) {
    const features = entry.view!.tile.features;
    entry.featureBuilding = new Int32Array(features.length);
    for (let i = 0; i < features.length; i++) entry.featureBuilding[i] = this.data.index.get(features[i].id) ?? -1;
  }

  private tileColors(entry: TileEntry): Uint8Array {
    const n = entry.featureBuilding!.length;
    const out = new Uint8Array(n * 4);
    const neutral = NEUTRAL[this.ui.mode];
    for (let i = 0; i < n; i++) {
      const b = entry.featureBuilding![i];
      let c = b >= 0 ? neutral.noData : neutral.context;
      if (b >= 0 && this.result && this.result.colors[b] !== NONE) c = this.result.colors[b];
      out[i * 4] = c >> 16;
      out[i * 4 + 1] = (c >> 8) & 255;
      out[i * 4 + 2] = c & 255;
      out[i * 4 + 3] = b >= 0 || this.ui.context ? 255 : 0;
    }
    return out;
  }

  private repaintAll(animate: boolean) {
    for (const entry of this.entries.values()) if (entry.view) this.layer.setColors(entry.view, this.tileColors(entry), animate);
  }

  // ---- data -----------------------------------------------------------------------------------------------------------
  /** new data tiles arrived (or were dropped): relink every 3D tile, then recolour (at most a few times a second) */
  private onData() {
    if (this.themeTimer) return;
    this.themeTimer = window.setTimeout(() => {
      this.themeTimer = 0;
      for (const e of this.entries.values()) if (e.view) this.linkFeatures(e);
      this.applyTheme(false);
      for (const e of this.entries.values()) this.trySelectPending(e);
      this.renderStatus();
    }, 250);
  }

  private applyTheme(animate = true) {
    this.result = this.data.buildings.length ? evaluateTheme(this.theme, this.data.buildings, this.ui.palette) : null;
    this.renderLayers();
    this.renderLegend();
    this.repaintAll(animate);
    this.renderFlat();
    this.renderInfo();
  }

  // ---- flat mode --------------------------------------------------------------------------------------------------------
  private setFlat(on: boolean) {
    this.flat = on;
    if (on) this.select(null);
    else this.selectFlat(null);
    if (this.map.getLayer(this.layer.id)) this.map.setLayoutProperty(this.layer.id, 'visibility', on ? 'none' : 'visible');
    this.renderFlat();
    this.renderStatus();
  }

  /** the active theme's layers as fill-extrusions on our tiles; the first layer of the theme is drawn on top */
  private renderFlat() {
    if (!this.map.getSource('fm')) return;
    for (const id of this.flatLayers) if (this.map.getLayer(id)) this.map.removeLayer(id);
    this.flatLayers = [];
    if (!this.flat) return;
    // "Omgeving": every building no layer of the theme draws, in the neutral grey of the 3D view (never under a
    // coloured block, so the two never fight over the same walls)
    const filters = this.theme.layers.map((rule) => layerStyle(rule, this.ui.palette).filter ?? true);
    if (this.ui.context && !filters.includes(true)) {
      this.map.addLayer({
        id: 'fm-flat-context', type: 'fill-extrusion', source: 'fm', 'source-layer': 'buildings', minzoom: 13,
        filter: ['!', ['any', ...filters]] as any,
        paint: {
          'fill-extrusion-color': toHex(NEUTRAL[this.ui.mode].noData),
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 8],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
        },
      }, 'fm-flat-selected');
      this.flatLayers.push('fm-flat-context');
    }
    for (const rule of [...this.theme.layers].reverse()) {
      const { filter, color } = layerStyle(rule, this.ui.palette);
      const id = `fm-flat-${rule}`;
      this.map.addLayer({
        id, type: 'fill-extrusion', source: 'fm', 'source-layer': 'buildings', minzoom: 13,
        ...(filter ? { filter: filter as any } : {}),
        paint: {
          'fill-extrusion-color': color as any,
          'fill-extrusion-height': ['coalesce', ['get', 'height'], 8],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
        },
      }, 'fm-flat-selected');
      this.flatLayers.push(id);
    }
  }

  /** properties of the building under the pointer in flat mode */
  private flatAt(x: number, y: number): Props | null {
    if (!this.flatLayers.length) return null;
    const f = this.map.queryRenderedFeatures([x, y], { layers: this.flatLayers })[0];
    return f ? (f.properties as Props) : null;
  }

  private selectFlat(sel: { id: string; props: Props } | null) {
    this.flatSelected = sel;
    if (sel) { this.selected = null; this.layer.setSelected(null, -1); }
    if (this.map.getLayer('fm-flat-selected')) {
      this.map.setFilter('fm-flat-selected', ['==', ['get', 'building_id'], sel ? String(sel.props.building_id) : '']);
    }
    this.loadPlace();
    this.renderInfo();
  }

  // ---- picking --------------------------------------------------------------------------------------------------------
  private visible = (view: TileView, feature: number) =>
    this.ui.context || (this.entryOfView.get(view)?.featureBuilding?.[feature] ?? -1) >= 0;

  private same(a: Hit | null, b: Hit | null) {
    return a?.view === b?.view && a?.feature === b?.feature;
  }

  select(hit: Hit | null) {
    if (!hit && this.flatSelected) return this.selectFlat(null);
    this.selected = hit;
    this.layer.setSelected(hit?.view ?? null, hit?.feature ?? -1);
    this.renderRing();
    this.loadPlace();
    this.renderInfo();
  }

  private setHover(hit: Hit | null) {
    if (this.same(hit, this.hovered)) return;
    const previous = this.hovered?.view ?? null;
    this.hovered = hit;
    this.layer.setHovered(hit?.view ?? null, hit?.feature ?? -1, previous);
    this.map.getCanvas().style.cursor = hit ? 'pointer' : '';
  }

  private trySelectPending(entry: TileEntry) {
    if (!this.pendingSelect || !entry.view) return;
    const f = entry.view.tile.features.findIndex((x) => x.id === this.pendingSelect);
    if (f < 0) return;
    this.pendingSelect = null;
    this.select({ view: entry.view, feature: f });
  }

  /** fly to a place from the search; select its pand once its tile is there */
  goTo(target: { lon: number; lat: number; zoom: number; buildingId?: string }) {
    this.pendingSelect = target.buildingId ?? null;
    this.select(null);
    this.map.flyTo({ center: [target.lon, target.lat], zoom: Math.max(this.map.getZoom(), target.zoom), pitch: 60, bearing: this.map.getBearing(), duration: 2600, essential: true });
    this.map.once('moveend', () => { for (const e of this.entries.values()) this.trySelectPending(e); });
  }

  get centre(): { lon: number; lat: number } {
    const c = this.map.getCenter();
    return { lon: c.lng, lat: c.lat };
  }

  private renderRing() {
    const source = this.map.getSource('selection') as GeoJSONSource | undefined;
    if (!source) return;
    const s = this.layer.selection;
    source.setData({ type: 'FeatureCollection', features: s ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: this.layer.toLngLat(s.x, s.y) } }] : [] });
    if (!s) return;
    const px = (zoom: number) => (s.radius + 3) * this.frame.scale * 512 * 2 ** zoom;
    this.map.setPaintProperty('selection-ring', 'circle-radius', ['interpolate', ['exponential', 2], ['zoom'], 10, px(10), 22, px(22)]);
    const accent = LOOKS[this.ui.mode].accent;
    this.map.setPaintProperty('selection-ring', 'circle-color', accent);
    this.map.setPaintProperty('selection-ring', 'circle-stroke-color', accent);
  }

  // ---- settings -------------------------------------------------------------------------------------------------------
  setGroup(g: string) {
    if (g === this.ui.group) return;
    this.ui.group = g;
    if (this.theme.group !== g) this.theme = THEMES.find((t) => t.group === g)!;
    this.ui.themeId = this.theme.id;
    this.applyTheme();
  }

  setTheme(id: string) {
    if (id === this.theme.id) return;
    this.theme = THEMES.find((t) => t.id === id)!;
    this.ui.themeId = id;
    this.applyTheme();
  }

  setLines(on: boolean) {
    this.ui.lines = on;
    this.layer.lines = on;
    store.set('fm-lines', on ? 'on' : 'off');
    this.map.triggerRepaint();
  }

  setShadows(on: boolean) {
    this.ui.shadows = on;
    this.layer.shadows = on;
    this.map.triggerRepaint();
  }

  setContext(on: boolean) {
    this.ui.context = on;
    this.repaintAll(false);
    this.renderFlat();
  }

  setPalette(p: PaletteName) {
    this.ui.palette = p;
    store.set('fm-palette', p);
    this.applyTheme();
  }

  toggleMode() {
    this.ui.mode = this.ui.mode === 'dark' ? 'light' : 'dark';
    store.set('fm-mode', this.ui.mode);
    this.applyMode(true);
  }

  private applyMode(animate: boolean) {
    document.documentElement.dataset.theme = this.ui.mode;
    restyle(this.map, this.ui.mode);
    this.layer.setMode(this.ui.mode);
    this.repaintAll(animate);
    this.renderRing();
    this.renderLegend();
    this.renderFlat();
    if (this.map.getLayer('fm-flat-selected')) this.map.setPaintProperty('fm-flat-selected', 'line-color', LOOKS[this.ui.mode].accent);
  }

  // ---- UI state -------------------------------------------------------------------------------------------------------
  private renderLayers() {
    this.ui.layers = THEMES.filter((t) => t.group === this.ui.group).map((t) => ({ id: t.id, name: t.name, ramp: ramp(legendColors(t, this.ui.palette)) }));
  }

  private renderLegend() {
    const legendUi = this.ui.legend;
    legendUi.title = this.theme.name;
    legendUi.note = this.theme.note ?? '';
    if (!this.result) {
      legendUi.total = '';
      legendUi.sections = [];
      legendUi.message = this.map.getZoom() < MIN_ZOOM_3D ? 'Zoom in voor de panden' : 'Gegevens laden…';
      return;
    }
    const n = this.data.buildings.length;
    const legend = countLegend(this.result, 0, n);
    const max = Math.max(1, ...legend.sections.flatMap((s) => s.rows.map((r) => r.count)), legend.none);
    const row = (color: number, name: string, count: number): LegendRowView => ({
      color: toHex(color), name, count: nf.format(count), width: count ? Math.max(1.5, (count / max) * 100) : 0, empty: !count,
    });
    legendUi.total = `${nf.format(n)} panden rond het beeld`;
    legendUi.message = '';
    legendUi.sections = legend.sections.map((s) => ({
      title: legend.sections.length > 1 ? s.title : '',
      rows: [...s.rows.map((r) => row(r.color, r.name, r.count)), ...(s.other ? [row(0x71decc, 'Overig', s.other)] : [])],
    }));
    if (legend.none) legendUi.sections.push({ title: ' ', rows: [row(NEUTRAL[this.ui.mode].noData, 'Niet in deze laag', legend.none)] });
  }

  private renderStatus() {
    const ready = [...this.entries.values()].filter((e) => e.state === 'ready');
    const loading = [...this.entries.values()].filter((e) => e.state === 'loading').length + this.queue.length + this.data.loading + (this.walking ? 1 : 0);
    const panden = ready.reduce((s, e) => s + (e.view?.tile.features.length ?? 0), 0);
    const mb = ready.reduce((s, e) => s + (e.view?.tile.bytes ?? 0), 0) / 1e6;
    let text: string;
    if (this.flat) text = '3D-modellen (3DBAG) niet bereikbaar · panden als blokken';
    else if (this.map.getZoom() < MIN_ZOOM_3D) text = 'Zoom in om de panden in 3D te laden';
    else if (loading) text = `3D-panden laden… ${nf.format(panden)} in beeld`;
    else text = `${nf.format(panden)} panden in 3D · ${ready.length} tegels · ${nf1.format(mb)} MB`;
    this.ui.status = { text, busy: loading > 0 };
  }

  /** the legend row a building falls in for the active layer */
  private valueOf(b: number): { color: number; label: string; title: string } {
    const neutral = NEUTRAL[this.ui.mode].noData;
    if (b < 0 || !this.result) return { color: neutral, label: 'Geen FunderMaps-gegevens', title: this.theme.name };
    const r = this.result.rows[b];
    if (r === -1) return { color: neutral, label: 'Niet in deze laag', title: this.theme.name };
    if (r === -2) return { color: this.result.colors[b], label: 'Overig', title: this.theme.name };
    const section = this.result.sections[r >> 8];
    return { color: section.rows[r & 255].color, label: section.rows[r & 255].name, title: this.result.sections.length > 1 ? section.title : this.theme.name };
  }

  private props(hit: Hit): { b: number; p: Props } {
    const b = this.entryOfView.get(hit.view)?.featureBuilding?.[hit.feature] ?? -1;
    return { b, p: b >= 0 ? this.data.buildings[b] : {} };
  }

  /** hover card: everything from our tile and the 3D BAG tile, no request */
  private renderTooltip(hit: Hit | null, x: number, y: number) {
    if (!hit) { this.ui.tooltip = null; return; }
    const { b, p } = this.props(hit);
    this.tooltipFor(b, p, hit.view.tile.features[hit.feature], x, y);
  }

  /** f = the 3D BAG feature, null in flat mode */
  private tooltipFor(b: number, p: Props, f: TileFeature | null, x: number, y: number) {
    const v = this.valueOf(b);
    const height = heightOf(f, p);
    const rel = p.foundation_type_reliability ? L.RELIABILITY[String(p.foundation_type_reliability)] ?? String(p.foundation_type_reliability) : null;
    const facts: [string, string | null][] = [
      ['Bouwjaar', p.construction_year ? String(p.construction_year) : f?.builtYear ? String(f.builtYear) : null],
      ['Hoogte', height !== null ? `${nf1.format(height)} m${f?.storeys ? ` · ${f.storeys} lagen` : ''}` : null],
      ['Fundering', p.foundation_type ? `${fmt(p.foundation_type, L.FOUNDATION_TYPE)}${rel ? ` (${rel})` : ''}` : null],
      ['Herstel', fmt(p.recovery_type, L.RECOVERY_TYPE)],
      ['Pandzakking', typeof p.velocity === 'number' ? `${nf1.format(p.velocity)} mm/jaar` : null],
      ['Risico', p.unclassified_risk ? fmt(p.unclassified_risk, L.RISK) : p.drystand_risk ? `Droogstand ${String(p.drystand_risk).toUpperCase()}` : null],
      ['Oppervlak', f?.area ? `${nf.format(Math.round(f.area))} m²${f.roofType ? ` · ${(L.ROOF_TYPE[f.roofType] ?? f.roofType).toLowerCase()}` : ''}` : null],
    ];
    const count = typeof p.address_count === 'number' ? p.address_count : 0;
    this.ui.tooltip = {
      x, y,
      title: b >= 0 ? 'Pand' : 'Pand zonder FunderMaps-gegevens',
      more: count > 1 ? `${nf.format(count)} adressen` : count === 1 ? '1 adres' : '',
      swatch: toHex(v.color), valueTitle: v.title, valueLabel: v.label,
      facts: facts.filter((x): x is [string, string] => !!x[1]).slice(0, 6),
    };
  }

  /** address, buurt, wijk and gemeente of the selected pand (our public geocoder) */
  private loadPlace() {
    const id = this.selected ? this.selected.view.tile.features[this.selected.feature].id : this.flatSelected?.id ?? null;
    if (id === this.infoFor) return;
    this.infoFor = id;
    this.place = null;
    this.infoAbort?.abort();
    if (!id) return;
    const abort = (this.infoAbort = new AbortController());
    buildingInfo(`NL.IMBAG.PAND.${id}`, abort.signal).then((info) => {
      if (abort.signal.aborted || this.infoFor !== id) return;
      this.place = info;
      this.renderInfo();
    });
  }

  private renderInfo() {
    let f: TileFeature | null = null, b = -1, p: Props = {}, pandId: string;
    if (this.selected) {
      f = this.selected.view.tile.features[this.selected.feature];
      ({ b, p } = this.props(this.selected));
      pandId = f.id;
    } else if (this.flatSelected) {
      pandId = this.flatSelected.id;
      b = this.data.index.get(pandId) ?? -1;
      p = b >= 0 ? this.data.buildings[b] : this.flatSelected.props;
    } else {
      this.ui.info = null;
      return;
    }
    const rel = (k: string) => (p[k] ? ` · ${L.RELIABILITY[String(p[k])] ?? String(p[k])}` : '');
    const height = heightOf(f, p);
    const v = this.valueOf(b);
    const place = this.place;
    const address = place?.street ? `${place.street} ${place.building_number ?? ''}`.trim() : null;
    const count = typeof p.address_count === 'number' ? p.address_count : 0;
    const keep = (list: [string, string | null][]) => list.filter((x): x is [string, string] => x[1] !== null);
    this.ui.info = {
      eyebrow: [place?.neighborhood_name, place?.municipality_name].filter(Boolean).join(' · '),
      title: address ?? (this.infoFor && !place ? 'Adres laden…' : 'Pand zonder adres'),
      sub: [place?.postal_code ? `${place.postal_code.slice(0, 4)} ${place.postal_code.slice(4)}` : null, count > 1 ? `en ${nf.format(count - 1)} ander${count > 2 ? 'e' : ''} adres${count > 2 ? 'sen' : ''}` : null].filter(Boolean).join(' · '),
      swatch: toHex(v.color), valueTitle: v.title, valueLabel: v.label,
      hasData: b >= 0,
      stats: [
        ['Bouwjaar', String(p.construction_year ?? f?.builtYear ?? '–')],
        ['Hoogte', height !== null ? `${nf1.format(height)} m` : '–'],
        ['Pandzakking', typeof p.velocity === 'number' ? `${nf1.format(p.velocity)} mm/j` : '–'],
        ['Funderingsrisico', p.unclassified_risk ? String(p.unclassified_risk).toUpperCase() : '–'],
      ],
      rows: keep([
        ['Funderingstype', p.foundation_type ? `${fmt(p.foundation_type, L.FOUNDATION_TYPE)}${rel('foundation_type_reliability')}` : null],
        ['Herstel', fmt(p.recovery_type, L.RECOVERY_TYPE)],
        ['Droogstand', p.drystand_risk ? `${fmt(p.drystand_risk, L.RISK)}${rel('drystand_risk_reliability')}` : null],
        ['Ontwateringsdiepte', p.dewatering_depth_risk ? `${fmt(p.dewatering_depth_risk, L.RISK)}${rel('dewatering_depth_risk_reliability')}` : null],
        ['Bacteriële aantasting', p.bio_infection_risk ? `${fmt(p.bio_infection_risk, L.RISK)}${rel('bio_infection_risk_reliability')}` : null],
        ['Herstelkosten', typeof p.restoration_costs === 'number' ? `€ ${nf.format(p.restoration_costs)}` : null],
        ['Rapportage', fmt(p.inquiry_type, L.INQUIRY_TYPE)],
        ['Schadeoorzaak', fmt(p.damage_cause, L.DAMAGE_CAUSE)],
        ['Kwaliteit', fmt(p.overall_quality, L.OVERALL_QUALITY)],
        ['Handhavingstermijn', typeof p.enforcement_term === 'number' ? `${nf.format(p.enforcement_term)} jaar` : null],
        ['Monitoring', p.monitoring === true ? 'Ja' : null],
      ]),
      bag: f ? keep([
        ['Status', f.status],
        ['Daktype', fmt(f.roofType, L.ROOF_TYPE)],
        ['Bouwlagen', f.storeys ? String(f.storeys) : null],
        ['Nokhoogte', height !== null ? `${nf1.format(height)} m boven maaiveld` : null],
        ['Grondoppervlak', f.area ? `${nf.format(Math.round(f.area))} m²` : null],
        ['Volume', f.volume ? `${nf.format(Math.round(f.volume))} m³` : null],
        ['Maaiveld', f.groundLevel !== null ? `${nf1.format(f.groundLevel)} m NAP` : null],
        ['Bouwjaar (BAG)', f.builtYear ? String(f.builtYear) : null],
      ]) : [],
      id: `NL.IMBAG.Pand.${pandId}`,
    };
  }
}

/** ridge height above ground from 3D BAG, else the height in our own data */
function heightOf(f: TileFeature | null, p: Props): number | null {
  if (f && f.ridgeHeight !== null && f.groundLevel !== null) return f.ridgeHeight - f.groundLevel;
  return typeof p.height === 'number' ? p.height : null;
}
