// The map: MapLibre draws the basemap, labels and controls; three.js draws the 3D BAG buildings in a custom layer
// (engine/scene.ts); every building is coloured by the live map app's rules from our own `buildings` tiles. This class
// owns everything heavy (not reactive) and writes a small, plain UI state that the Vue components render.
import { Map as MapLibreMap, NavigationControl, ScaleControl, GeolocateControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// MapLibre 6 looks for its worker as `maplibre-gl-worker.mjs` next to its own file, a name the bundler cannot see, so
// the worker never ends up in the build ("Worker failed to load"). Ship it as an asset and say where it is.
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { makeFrame, type Frame } from '@/engine/frame';
import { softwareRenderer } from '@/engine/gpu';
// Of the 3D engine only types are imported here: the engine itself is fetched when the 3D view is shown (load3d).
import type { Engine3d } from '@/engine/engine3d';
import type { TileFeature } from '@/engine/tiles';
import type { BuildingLayer, Mode, TileView } from '@/engine/scene';
import { prepareStyle, restyle, LOOKS } from '@/engine/basemap';
import { GROUPS, THEMES, NONE, countLegend, evaluateTheme, layerStyle, legendColors, legendRows, legendTitle, mapsetThemes, setLegends, type Theme, type ThemeResult } from '@/engine/themes';
import AREA_LAYERS from '@/config/area-layers.json';
import { toHex, type PaletteName } from '@/engine/palette';
import * as L from '@/engine/labels';
import { BuildingData, type Props } from '@/data/building-data';
import { TreeData } from '@/data/trees';
import { bagId, buildingInfo, type BuildingInfo } from '@/search/search';
import { fenceExpression, fenceTest, listMapsets, loadMapset, type Mapset } from '@/map/mapsets';
import { loadPosition, savePosition, type Position } from '@/map/position';
import { loadSession, toLogin } from '@/api/session';
import { parseRoute, writeRoute, type Route } from '@/map/route';
import { markdown } from '@/lib/markdown';
import type { LeafTile } from '@/engine/bag3d-tileset';
import { ALL_LAYERS, BASEMAP, BUILDINGS_3D, TILESERVER } from '@/config';

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
  /** the building-block outlines ("Bouwkundige eenheid") on the ground */
  clusters: boolean;
  /** the open mapset (/map/<slug>): its name, note and disclaimer as HTML */
  mapset: null | { id: string; name: string; note: string; consent: string };
  /** the mapsets to choose from (a user's organisation's), for the picker */
  mapsets: { id: string; slug: string; name: string }[];
  /** the trees of the BGT in the 3D view */
  trees: boolean;
  /** buildings as plain blocks from our own tiles instead of 3D models: the visitor's choice, or the device's default */
  flat: boolean;
  /** the organisation whose buildings "Filter op eigendom" keeps, and whether it is on */
  owner: string | null;
  ownerOnly: boolean;
  /** a message above the layers, e.g. a mapset in the address that could not be opened */
  notice: string;
  /** a logged-in user whose organisation has no map: nothing to show but that, and the way out */
  noMapsets: boolean;
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
    // shadows, the surroundings and the 2026 colours are simply on (Yorick 2026-11-12): no switches for them
    palette: '2026',
    groups: GROUPS, group: THEMES[0].group, themeId: THEMES[0].id, layers: [],
    // building outlines: off (Yorick 2026-10-22: "remove the outline on the 3d buildings, its convoluted"); the selected
    // and hovered building keep theirs
    lines: false, shadows: true, context: true, clusters: false, mapset: null, mapsets: [], owner: null, ownerOnly: false, flat: false, trees: store.get('fm-trees') !== 'off', notice: '', noMapsets: false,
    legend: { title: '', total: '', note: '', sections: [], message: 'Gegevens laden…' },
    status: { text: 'Laden…', busy: true },
    tooltip: null, info: null,
  };
}

// ---- constants ------------------------------------------------------------------------------------------------------
const START = { center: [4.4655, 51.9145] as [number, number], zoom: 15.5, pitch: 66, bearing: 72 };
const MIN_ZOOM_3D = 13.5;
/** trees are loaded from this zoom on: further out there are too many for what they add */
const MIN_ZOOM_TREES = 15;
/** load 3D tiles up to this many metres from the view centre: the far horizon of a tilted view stays empty */
const tileDistance = (zoom: number) => Math.min(4500, Math.max(1200, 2200 * 2 ** (16 - zoom)));
/** at most this many 3D tiles in memory; the farthest go first */
const MAX_TILES = 40;
/** past this distance from the frame origin the scene starts over around the view (keeps float32 metres small) */
const REFRAME_METRES = 40000;
/**
 * An empty layer that keeps the place of the 3D buildings in the style, above the ground layers and under the 2D
 * buildings: the 3D layer itself is only there once its engine is loaded.
 */
const SLOT_3D = 'fm-3d-slot';
const NEUTRAL: Record<Mode, { noData: number; context: number }> = {
  light: { noData: 0xdcdfe4, context: 0xeeeff1 },
  dark: { noData: 0x4a525d, context: 0x2b313a },
};
const ATTRIBUTION = `${BUILDINGS_3D.attribution} · Bomen <a href="https://www.pdok.nl/introductie/-/article/basisregistratie-grootschalige-topografie-bgt-" target="_blank" rel="noopener">BGT</a> · Gegevens FunderMaps`;

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
  /**
   * The 3D view. Its engine (three.js, the tile workers, the walk over the 3D tileset) is a part of the build of its
   * own, fetched the first time the 3D view is shown (load3d); its layer is put on the map then (addLayer3d). A 2D map
   * has neither, and downloads nothing of them.
   */
  private engine: Engine3d | null = null;
  private layer: BuildingLayer | null = null;
  private loading3d: Promise<Engine3d | null> | null = null;
  /** this device draws in software (no GPU): the 3D models cost too much there */
  private software = false;
  private data: BuildingData;
  /** the 3D BAG leaf tiles of the last walk, by uri */
  private leaves = new Map<string, LeafTile>();
  private walkSeq = 0;
  private walkError = false;
  private walking = false;
  private entries = new Map<string, TileEntry>();
  private entryOfView = new Map<TileView, TileEntry>();
  private queue: string[] = [];
  private active = 0;
  /** the tabs and their layers: every layer by subject, or the layer set of the open mapset */
  private catalog: { groups: string[]; themes: Theme[] } = { groups: GROUPS, themes: THEMES };
  private theme: Theme = THEMES[0];
  private mapset: Mapset | null = null;
  /** the open mapset's fence as a MapLibre filter (flat mode) */
  private fence: unknown[] | null = null;
  /** the mapset, building and panel in the address */
  private route: Route;
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
  private trees: TreeData;
  private treeCells = new Map<string, Float64Array>();
  private flat = false;
  /** flat because it was chosen (or is this device's default), not because the 3D models cannot be reached */
  private wantFlat = false;
  private flatLayers: string[] = [];
  private flatSelected: { id: string; props: Props } | null = null;

  /**
   * Start the map on the basemap already restyled, so the original basemap never shows while it loads. A mapset and a
   * building in the address are looked up at the same time, so the map opens on them.
   */
  static async create(container: HTMLElement, ui: UiState, route: Route): Promise<MapController | null> {
    const style = fetch(BASEMAP)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((json) => prepareStyle(json, ui.mode))
      .catch(() => BASEMAP as any); // the plain style URL then; it is restyled once loaded
    const target = route.building ? locate(route.building, AbortSignal.timeout(8000)) : null;
    // Who is looking decides which mapsets there are: a user has their organisation's, and any public one by its
    // link; a guest only public ones. Every view is a mapset's view, as on the current map: its layers, inside its
    // fence. Without one there is no data on the map.
    const user = await loadSession();
    const own = user ? await listMapsets(AbortSignal.timeout(8000)).catch(() => [] as Mapset[]) : [];
    const open = async (idOrSlug: string): Promise<Mapset | null> =>
      own.find((x) => x.id === idOrSlug || x.slug === idOrSlug) ?? (await loadMapset(idOrSlug, !!user, AbortSignal.timeout(8000)).catch(() => null));
    const mapset = (async (): Promise<Mapset | null> => {
      // The one in the address; else the one looked at last; else a user's first. "Last" is this map's own note of it,
      // and for someone coming from the current map that app's two notes, a public one first as it does. A guest has
      // no private one: theirs does not open, and the next is tried.
      let m = route.mapset ? await open(route.mapset) : null;
      for (const key of user ? ['fm-last-mapset', 'last-viewed-public-mapset', 'last-viewed-private-mapset'] : ['fm-last-mapset', 'last-viewed-public-mapset']) {
        const last = m ? null : store.get(key);
        if (last && last !== route.mapset) m = await open(last);
      }
      return m ?? own[0] ?? null;
    })();
    // where the visitor last was, unless the address already says where to look
    const position = route.building || route.lat !== null || location.hash.length > 1 ? null : loadPosition(!!user);
    const [s, m, t, p] = await Promise.all([style, mapset, target, position]);
    if (!m && !ALL_LAYERS) {
      // nothing to show. A guest logs in (and comes back to this address); a user is told, and can log out.
      if (!user) { toLogin(); return new Promise<null>(() => { /* the page is leaving */ }); }
      ui.noMapsets = true;
      return null;
    }
    if (route.mapset && m && m.id !== route.mapset && m.slug !== route.mapset) ui.notice = `De kaart “${route.mapset}” is niet gevonden of niet voor u beschikbaar. U ziet “${m.name}”.`;
    const all = m && !own.some((x) => x.id === m.id) ? [m, ...own] : own;
    ui.mapsets = all.map((x) => ({ id: x.id, slug: x.slug, name: x.name }));
    ui.owner = user?.organizations[0]?.name ?? null;
    return new MapController(container, ui, s, m ? { ...route, mapset: m.slug } : route, m, t, p, !!user);
  }

  private constructor(container: HTMLElement, private ui: UiState, style: any, route: Route, mapset: Mapset | null,
    target: { pand: string; lon: number; lat: number } | null, saved: Position | null, private isUser: boolean) {
    // the opening sweep is for a first visit; someone coming back to where they were just gets their view
    const intro = location.hash.length <= 1 && !saved;
    // where to open (the hash, when there is one, wins inside MapLibre): the building, ?lat&lng, the mapset, Rotterdam
    const start = target ? { ...START, center: [target.lon, target.lat] as [number, number], zoom: 17.4, pitch: 60 }
      : route.lat !== null && route.lng !== null ? { ...START, center: [route.lng, route.lat] as [number, number], zoom: 17, pitch: 60 }
      : saved ? { center: [saved.lng, saved.lat] as [number, number], zoom: saved.zoom, pitch: saved.pitch, bearing: saved.bearing }
      : mapset?.center ? { ...START, center: mapset.center, zoom: 15, pitch: 58 }
      : START;
    this.route = { ...route, building: target?.pand ?? route.building };
    this.pendingSelect = target?.pand ?? null;
    this.frame = makeFrame(start.center[0], start.center[1]);
    this.data = new BuildingData(TILESERVER, () => this.onData());
    // the trees of each cell go to whichever scene is current (the scene starts over far across the country); a scene
    // that comes later gets the cells kept here
    this.trees = new TreeData((key, lonLat) => {
      if (lonLat) this.treeCells.set(key, lonLat); else this.treeCells.delete(key);
      this.layer?.setTrees(key, lonLat);
      this.renderStatus();
    });
    this.map = new MapLibreMap({
      container,
      style,
      center: start.center,
      zoom: intro ? start.zoom - 0.4 : start.zoom,
      pitch: intro ? 38 : start.pitch,
      bearing: intro ? start.bearing - 78 : start.bearing,
      maxPitch: 78,
      hash: true,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true, customAttribution: ATTRIBUTION },
    });
    this.map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'top-right');
    this.map.addControl(new ScaleControl({ maxWidth: 110 }), 'bottom-right');
    // 3D or blocks: what the visitor chose before; else blocks on a phone and without a GPU, where the 3D models
    // cost too much (the current map app works on any phone), and 3D everywhere else. ?view=3d|flat tries the other.
    // Decided here, on the map's own WebGL context, so the 3D engine is not needed to know it.
    this.software = softwareRenderer(this.map.getCanvas().getContext('webgl2'));
    const asked = new URLSearchParams(location.search).get('view') ?? store.get('fm-view');
    this.wantFlat = asked === 'flat' || (asked !== '3d' && (this.software || matchMedia('(max-width: 640px)').matches));
    ui.flat = this.wantFlat;
    // a 3D map fetches its engine while the map itself loads, as it did when the engine was part of the page's script
    if (!this.wantFlat) void this.load3d();
    if (mapset) this.setMapset(mapset);
    else { this.restoreTheme(); ui.group = this.theme.group; ui.themeId = this.theme.id; this.renderLayers(); this.renderLegend(); }
    // the address follows the map from here: canonical form (old /kaart/… and …/gebouw/… links), Back and Forward. An
    // address naming a mapset that did not open is left as it was.
    if (!route.mapset || mapset) writeRoute(this.route, false);
    addEventListener('popstate', () => this.followRoute(parseRoute()));

    this.map.on('load', () => {
      const firstSymbol = this.firstSymbol();
      this.map.addSource('selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      this.map.addLayer({
        id: 'selection-ring', type: 'circle', source: 'selection',
        paint: { 'circle-pitch-alignment': 'map', 'circle-color': '#3E63DD', 'circle-opacity': 0.08, 'circle-stroke-color': '#3E63DD', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.6, 'circle-radius': 0 },
      }, firstSymbol);
      // the place of the 3D buildings: they are put here once their engine is loaded (addLayer3d)
      this.map.addLayer({ id: SLOT_3D, type: 'background', layout: { visibility: 'none' } }, firstSymbol);
      // flat mode: our own building tiles (layers added by renderFlat) and the outline of a building picked there
      this.map.addSource('fm', { type: 'vector', url: `${TILESERVER}/buildings` });
      this.map.addLayer({
        id: 'fm-flat-selected', type: 'line', source: 'fm', 'source-layer': 'buildings', minzoom: 13,
        filter: ['==', ['get', 'building_id'], ''], paint: { 'line-color': LOOKS[ui.mode].accent, 'line-width': 3 },
      }, firstSymbol);
      // without a GPU the shadow pass costs seconds per frame: start with shadows off there (?shadows=on forces them)
      const forced = new URLSearchParams(location.search).get('shadows');
      ui.shadows = forced ? forced === 'on' : !this.software;
      this.applyMode(false);
      // the opening sweep belongs to the 3D view; a 2D map just opens, seen from straight above (unless the address
      // or a remembered position says how to look)
      if (intro && !this.wantFlat) this.map.easeTo({ ...start, duration: 3200, easing: (t) => 1 - Math.pow(1 - t, 3) });
      else {
        if (intro) this.map.jumpTo({ center: start.center, zoom: start.zoom, pitch: 0, bearing: 0 });
        this.onMoveEnd();
      }
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
          this.tooltipFor(b, b >= 0 ? this.data.buildings[b] : this.data.outside.has(id) ? {} : p, null, e.point.x, e.point.y, id);
          return;
        }
        const hit = this.layer?.pick(e.point.x, e.point.y, this.visible) ?? null;
        this.setHover(hit);
        this.renderTooltip(hit, e.point.x, e.point.y);
      });
    });
    this.map.on('mouseout', () => { this.setHover(null); this.renderTooltip(null, 0, 0); });
    this.map.on('movestart', () => this.renderTooltip(null, 0, 0));
    this.map.on('click', (e) => {
      if (!this.flat) return this.select(this.layer?.pick(e.point.x, e.point.y, this.visible) ?? null);
      const p = this.flatAt(e.point.x, e.point.y);
      this.selectFlat(p ? { id: String(p.building_id).slice(-16), props: p } : null);
    });
    if (location.search.includes('debug')) {
      Object.assign(window as any, { __pick: (x: number, y: number) => this.layer?.pick(x, y, this.visible) ?? null, __ctl: this });
      // the 3D layer comes later, and another one when the scene starts over: always the one there is now (or null)
      Object.defineProperty(window, '__layer', { get: () => this.layer, configurable: true });
    }
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
    this.updateTrees();
    savePosition(this.isUser, { lng: c.lng, lat: c.lat, zoom: this.map.getZoom(), pitch: this.map.getPitch(), bearing: this.map.getBearing() });
  }

  /** start the 3D scene over around a new origin (far across the country) */
  private reframe(lon: number, lat: number) {
    this.select(null);
    this.setHover(null);
    this.queue.length = 0;
    for (const e of this.entries.values()) if (e.view) this.layer?.removeTile(e.view);
    this.entries.clear();
    this.entryOfView.clear();
    this.frame = makeFrame(lon, lat);
    // a map that has not shown 3D yet has no scene to start over: its layer is made around the new origin when it comes
    if (!this.engine || !this.layer) return;
    this.map.removeLayer(this.layer.id);
    this.addLayer3d(this.engine);
  }

  /**
   * The 3D engine, fetched once. Null when it could not be fetched, or when 2D was chosen while it was on its way: it
   * is asked for again the next time the 3D view is shown. Does not touch the map, so it can start before the map has
   * loaded.
   */
  private load3d(): Promise<Engine3d | null> {
    if (this.engine) return Promise.resolve(this.engine);
    this.loading3d ??= import('@/engine/engine3d')
      .then(({ createEngine3d }) => {
        // back in 2D by the time it arrives: no workers are started for a view that is not shown
        if (this.wantFlat) return null;
        return (this.engine = createEngine3d(BUILDINGS_3D.base, BUILDINGS_3D.root));
      })
      .catch((err) => { console.error(err); return null; })
      .finally(() => { this.loading3d = null; });
    return this.loading3d;
  }

  /** a new 3D layer around the frame origin, in its place in the style, set as the map is now */
  private addLayer3d(engine: Engine3d) {
    const layer = (this.layer = engine.makeLayer(this.frame));
    layer.lines = this.ui.lines;
    layer.shadows = this.ui.shadows;
    this.map.addLayer(layer, SLOT_3D);
    // while our own tiles draw the buildings (2D, or blocks when the 3D models cannot be reached) it is hidden: setFlat
    if (this.flat) this.map.setLayoutProperty(layer.id, 'visibility', 'none');
    layer.setMode(this.ui.mode);
    for (const [key, lonLat] of this.treeCells) layer.setTrees(key, lonLat);
  }

  // ---- trees ----
  /** trees belong to the 3D view, from close by: in 2D and from far away there are none */
  private updateTrees() {
    if (!this.ui.trees || this.wantFlat || this.flat || this.map.getZoom() < MIN_ZOOM_TREES) {
      if (this.treeCells.size) this.trees.clear();
      return;
    }
    const b = this.map.getBounds(), c = this.map.getCenter();
    this.trees.update([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [c.lng, c.lat]);
  }

  setTrees(on: boolean) {
    this.ui.trees = on;
    store.set('fm-trees', on ? 'on' : 'off');
    this.updateTrees();
    this.renderStatus();
  }

  // ---- 3D tiles -----------------------------------------------------------------------------------------------------
  private async updateTiles() {
    if (!this.map.getLayer(SLOT_3D)) return this.renderStatus();
    if (this.wantFlat) {
      if (!this.flat) this.setFlat(true);
      return this.renderStatus();
    }
    // the 3D view is shown: the first time, its engine comes first
    let engine = this.engine;
    if (!engine) {
      const fetched = this.load3d();
      this.renderStatus();
      engine = await fetched;
      // 2D was chosen while it was on its way
      if (this.wantFlat) return this.renderStatus();
    }
    if (!engine) {
      // it could not be fetched (offline, or a newer version is live): blocks, as when the 3D models cannot be reached
      if (!this.flat) this.setFlat(true);
      return this.renderStatus();
    }
    // one layer, also when two view changes waited for the engine
    if (!this.layer) this.addLayer3d(engine);
    if (this.map.getZoom() < MIN_ZOOM_3D) return this.renderStatus();
    const view = this.map.getBounds();
    const seq = ++this.walkSeq;
    let found: LeafTile[];
    this.walking = true;
    this.renderStatus();
    try {
      found = await engine.tileset.leaves([view.getWest(), view.getSouth(), view.getEast(), view.getNorth()]);
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
    for (const t of found) this.leaves.set(t.uri, t);
    const c = this.map.getCenter();
    const limit = tileDistance(this.map.getZoom());
    const wanted = found
      .map((t) => ({ t, d: distanceTo(t.bounds, c) }))
      .filter((x) => x.d < limit)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_TILES);
    this.queue.length = 0;
    for (const { t } of wanted) if (!this.entries.has(t.uri)) this.queue.push(t.uri);
    this.evict(new Set(wanted.map((w) => w.t.uri)));
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
      this.layer?.removeTile(e.view!);
      this.entryOfView.delete(e.view!);
      this.entries.delete(e.uri);
    }
  }

  private pump() {
    // tiles are only queued by the 3D view, which has its engine and its layer by then
    const engine = this.engine;
    if (!engine) return;
    while (this.active < 4 && this.queue.length) {
      const uri = this.queue.shift()!;
      const t = this.leaves.get(uri);
      if (this.entries.has(uri) || !t) continue;
      const { done } = engine.workers.request(engine.tileset.base + uri, this.frame, t.transform);
      const entry: TileEntry = { uri, bounds: t.bounds, state: 'loading' };
      const layer = this.layer;
      this.entries.set(uri, entry);
      this.active++;
      done
        .then((tile) => {
          if (this.entries.get(uri) !== entry || layer !== this.layer || !layer) return;
          entry.state = 'ready';
          entry.view = layer.addTile(tile, new Uint8Array(tile.features.length * 4));
          this.entryOfView.set(entry.view, entry);
          this.linkFeatures(entry);
          layer.setColors(entry.view, this.tileColors(entry), false);
          this.trySelectPending(entry);
        })
        .catch((err) => {
          if (String(err).includes('aborted')) return;
          console.error(err);
          entry.state = 'error';
          // a tile that failed (a hiccup at the 3D server) left a hole for the rest of the visit: forget it after a
          // while, so the next view change asks for it again
          setTimeout(() => { if (this.entries.get(uri) === entry) this.entries.delete(uri); }, 8000);
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
    for (const entry of this.entries.values()) if (entry.view) this.layer?.setColors(entry.view, this.tileColors(entry), animate);
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
      this.trySelectPendingFlat();
      this.renderStatus();
    }, 250);
  }

  private applyTheme(animate = true) {
    // an area theme colours no buildings (they stay neutral) and draws its layer on the ground
    this.result = this.data.buildings.length && !this.theme.area ? evaluateTheme(this.theme, this.data.buildings, this.ui.palette) : null;
    this.renderLayers();
    this.renderLegend();
    this.repaintAll(animate);
    this.renderArea();
    this.renderFlat();
    this.renderInfo();
  }

  // ---- ground layers (areas, building blocks) ----------------------------------------------------------------------------
  /** a vector source on our tileserver by name, added once ('buildings' is the flat-mode source 'fm') */
  private sourceFor(name: string): string {
    if (name === 'buildings') return 'fm';
    const id = `fm-${name}`;
    if (!this.map.getSource(id)) this.map.addSource(id, { type: 'vector', url: `${TILESERVER}/${name}` });
    return id;
  }

  /** one of the current map app's own layers (area-layers.json) on the ground, under the 3D buildings */
  private addGround(layerId: string, id: string) {
    const spec = (AREA_LAYERS as Record<string, any>)[layerId];
    if (!spec || !this.map.getLayer(SLOT_3D)) return;
    // the current map app keeps its layers hidden until a user turns them on: here they are on when added. Under the 3D
    // layer, or under its place when it is not there (yet): it then comes above them.
    this.map.addLayer({ ...spec, id, source: this.sourceFor(spec.source), layout: { ...spec.layout, visibility: 'visible' } }, this.layer?.id ?? SLOT_3D);
  }

  private renderArea() {
    if (!this.map.getSource('fm')) return;
    if (this.map.getLayer('fm-area')) this.map.removeLayer('fm-area');
    if (this.theme.area) this.addGround(this.theme.area, 'fm-area');
  }

  setClusters(on: boolean) {
    this.ui.clusters = on;
    if (this.map.getLayer('fm-cluster')) this.map.removeLayer('fm-cluster');
    if (on) this.addGround('building-cluster', 'fm-cluster');
  }

  // ---- flat mode --------------------------------------------------------------------------------------------------------
  private setFlat(on: boolean) {
    this.flat = on;
    if (on) this.select(null);
    else this.selectFlat(null);
    if (this.layer) this.map.setLayoutProperty(this.layer.id, 'visibility', on ? 'none' : 'visible');
    this.renderFlat();
    this.renderStatus();
  }

  /** the visitor's choice between the 3D models and plain blocks; remembered in this browser */
  setView(flat: boolean) {
    store.set('fm-view', flat ? 'flat' : '3d');
    this.wantFlat = this.ui.flat = flat;
    if (flat) {
      // the 3D models go: nothing of them is kept in memory while the blocks are shown
      this.walkSeq++;
      this.queue.length = 0;
      this.setHover(null);
      for (const e of this.entries.values()) if (e.view) this.layer?.removeTile(e.view);
      this.entries.clear();
      this.entryOfView.clear();
      this.setFlat(true);
      this.updateTrees();
      // a 2D map is looked at from straight above
      this.map.easeTo({ pitch: 0, duration: 600 });
    } else {
      this.setFlat(false);
      if (this.map.getPitch() < 20) this.map.easeTo({ pitch: START.pitch, duration: 600 });
      void this.updateTiles();
    }
  }

  /** the active theme's layers as fill-extrusions on our tiles; the first layer of the theme is drawn on top */
  private renderFlat() {
    if (!this.map.getSource('fm')) return;
    for (const id of this.flatLayers) if (this.map.getLayer(id)) this.map.removeLayer(id);
    this.flatLayers = [];
    if (!this.flat) return;
    // By choice ("3D-panden" off) the buildings are flat shapes on the ground, a plain 2D map. Only when the 3D models
    // cannot be reached do they stand up as blocks, so the map still reads as the 3D one.
    const planes = this.wantFlat;
    const paint = (color: unknown, lift: number) => (planes
      ? { 'fill-color': color, 'fill-opacity': 0.92 }
      : { 'fill-extrusion-color': color, 'fill-extrusion-height': ['+', ['coalesce', ['get', 'height'], 8], lift], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.92 }) as any;
    // one of two layer types: the style spec's types cannot say "either"
    const type: any = planes ? 'fill' : 'fill-extrusion';
    // "Omgeving": every building no layer of the theme draws, in the neutral grey of the 3D view (never under a
    // coloured block, so the two never fight over the same walls). Layers on other sources (facade scan, incidents) are
    // drawn on their own tiles, so the grey cannot exclude their buildings: there the coloured blocks sit just above it.
    const styles = this.theme.layers.map((rule) => {
      const style = layerStyle(rule, this.ui.palette);
      // outside the mapset's fence a building stays grey, as in 3D
      const filter = this.fence ? (style.filter ? ['all', style.filter, this.fence] : this.fence) : style.filter;
      return { rule, ...style, filter };
    });
    const filters = styles.filter((s) => s.source === 'buildings').map((s) => s.filter ?? true);
    if (this.ui.context && !filters.includes(true)) {
      this.map.addLayer({
        id: 'fm-flat-context', type, source: 'fm', 'source-layer': 'buildings', minzoom: 13,
        ...(filters.length ? { filter: ['!', ['any', ...filters]] as any } : {}),
        paint: paint(toHex(NEUTRAL[this.ui.mode].noData), 0),
      }, 'fm-flat-selected');
      this.flatLayers.push('fm-flat-context');
    }
    for (const { rule, filter, color, source } of [...styles].reverse()) {
      const id = `fm-flat-${rule}`;
      const own = source !== 'buildings';
      this.map.addLayer({
        id, type, source: this.sourceFor(source), 'source-layer': source, minzoom: 13,
        ...(filter ? { filter: filter as any } : {}),
        // as blocks: a few centimetres higher than the grey context blocks, which share these buildings' walls
        paint: paint(color, own ? 0.05 : 0),
      }, 'fm-flat-selected');
      this.flatLayers.push(id);
    }
  }

  /** properties of the building under the pointer in flat mode */
  private flatAt(x: number, y: number): Props | null {
    if (!this.flatLayers.length) return null;
    const f = this.map.queryRenderedFeatures([x, y], { layers: this.flatLayers })[0];
    if (!f) return null;
    // the pand id is building_id on buildings, external_id on facade_scan, id on incident
    const p = f.properties as Props;
    return { ...p, building_id: p.building_id ?? p.external_id ?? p.id };
  }

  private selectFlat(sel: { id: string; props: Props } | null) {
    this.flatSelected = sel;
    if (sel) { this.selected = null; this.layer?.setSelected(null, -1); }
    if (this.map.getLayer('fm-flat-selected')) {
      this.map.setFilter('fm-flat-selected', ['==', ['get', 'building_id'], sel ? String(sel.props.building_id) : '']);
    }
    this.loadPlace();
    this.renderInfo();
    this.writeSelection();
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
    this.layer?.setSelected(hit?.view ?? null, hit?.feature ?? -1);
    this.renderRing();
    this.loadPlace();
    this.renderInfo();
    this.writeSelection();
  }

  private setHover(hit: Hit | null) {
    if (this.same(hit, this.hovered)) return;
    const previous = this.hovered?.view ?? null;
    this.hovered = hit;
    this.layer?.setHovered(hit?.view ?? null, hit?.feature ?? -1, previous);
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
    // the tile or the data may be there already (a building close by): then nothing arrives any more to select it on
    this.map.once('moveend', () => { for (const e of this.entries.values()) this.trySelectPending(e); this.trySelectPendingFlat(); });
  }

  get centre(): { lon: number; lat: number } {
    const c = this.map.getCenter();
    return { lon: c.lng, lat: c.lat };
  }

  private renderRing() {
    const source = this.map.getSource('selection') as GeoJSONSource | undefined;
    if (!source) return;
    const s = this.layer?.selection;
    source.setData({ type: 'FeatureCollection', features: s ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: this.layer!.toLngLat(s.x, s.y) } }] : [] });
    if (!s) return;
    const px = (zoom: number) => (s.radius + 3) * this.frame.scale * 512 * 2 ** zoom;
    this.map.setPaintProperty('selection-ring', 'circle-radius', ['interpolate', ['exponential', 2], ['zoom'], 10, px(10), 22, px(22)]);
    const accent = LOOKS[this.ui.mode].accent;
    this.map.setPaintProperty('selection-ring', 'circle-color', accent);
    this.map.setPaintProperty('selection-ring', 'circle-stroke-color', accent);
  }

  // ---- mapsets and the address ----------------------------------------------------------------------------------------
  /** open a mapset: its layer set becomes the layer list (names and legends from the API), its fence limits the data */
  private setMapset(m: Mapset) {
    this.mapset = m;
    setLegends(m.layers);
    const themes = mapsetThemes(m.name, m.layers);
    this.catalog = themes.length ? { groups: [m.name], themes } : { groups: GROUPS, themes: THEMES };
    this.theme = this.catalog.themes[0];
    this.restoreTheme();
    this.ui.groups = this.catalog.groups;
    this.ui.group = this.theme.group;
    this.ui.themeId = this.theme.id;
    this.ui.mapset = { id: m.id, name: m.name, note: m.note ? markdown(m.note) : '', consent: m.consent ? markdown(m.consent) : '' };
    store.set(m.public ? 'last-viewed-public-mapset' : 'last-viewed-private-mapset', m.id);
    store.set('fm-last-mapset', m.id);
    this.applyFence();
    document.title = `${m.name} · Funderingskaart`;
    this.applyTheme(false);
  }

  /**
   * Which buildings carry data: those inside the open mapset's fence and, with "Filter op eigendom" on, those whose
   * owner in our tiles is the user's organisation (as the current map app filters). The rest stays neutral.
   */
  private applyFence() {
    const fence = this.mapset ? fenceTest(this.mapset.fence) : null;
    const owner = this.ui.ownerOnly ? this.ui.owner : null;
    const expressions = [this.mapset ? fenceExpression(this.mapset.fence) : null, owner ? ['==', ['get', 'owner'], owner] : null].filter(Boolean) as unknown[][];
    this.fence = expressions.length > 1 ? ['all', ...expressions] : expressions[0] ?? null;
    this.data.setFence(fence || owner ? (p) => (!fence || fence(p)) && (!owner || p.owner === owner) : null);
    if (this.flat) this.renderFlat();
  }

  setOwnerOnly(on: boolean) {
    this.ui.ownerOnly = on && !!this.ui.owner;
    this.applyFence();
  }

  /** another mapset: a fresh page on its address, so nothing of the previous one lingers */
  openMapset(slug: string) {
    location.assign(`/map/${encodeURIComponent(slug)}`);
  }

  /** the selected building into the address (a new history entry, so Back closes it) */
  private writeSelection() {
    const pand = this.selected ? this.selected.view.tile.features[this.selected.feature].id : this.flatSelected?.id ?? null;
    if (pand === this.route.building) return;
    // The building the address names (or one just searched for) is still on its way to being selected. Until it is, the
    // address keeps naming it, with its panel: clearing it here lost the panel of a link opened in the 2D view.
    if (!pand && this.pendingSelect) return;
    // a building link names a mapset; without one the camera in the hash is the link
    this.route = { ...this.route, building: pand, panel: pand ? this.route.panel : null };
    if (this.mapset) writeRoute(this.route, true);
  }

  /** Back or Forward: open or close the building the address names */
  private followRoute(r: Route) {
    this.route = { ...this.route, building: r.building, panel: r.panel };
    const current = this.selected ? this.selected.view.tile.features[this.selected.feature].id : this.flatSelected?.id ?? null;
    if (r.building === current) return;
    if (!r.building) { this.pendingSelect = null; this.select(null); return; }
    locate(r.building).then((t) => { if (t) this.goTo({ lon: t.lon, lat: t.lat, zoom: 17.4, buildingId: t.pand }); });
  }

  /** flat mode: select the building from the address or a search once its data is there */
  private trySelectPendingFlat() {
    if (!this.flat || !this.pendingSelect) return;
    const b = this.data.index.get(this.pendingSelect);
    if (b === undefined) {
      // Not in our data, or outside this map's area. Once the map has arrived and nothing is loading any more, the
      // building still opens, on its address alone.
      if (this.data.loading > 0 || this.map.isMoving()) return;
      const id = this.pendingSelect;
      this.pendingSelect = null;
      this.selectFlat({ id, props: { building_id: `NL.IMBAG.PAND.${id}` } });
      return;
    }
    const props = this.data.buildings[b];
    this.pendingSelect = null;
    this.selectFlat({ id: String(props.id), props });
  }

  // ---- settings -------------------------------------------------------------------------------------------------------
  /** the layer chosen on this mapset (or on the map without one) the last time, when it still exists */
  private restoreTheme() {
    const id = store.get(`fm-layer-${this.mapset?.id ?? 'all'}`);
    const t = id ? this.catalog.themes.find((x) => x.id === id) : undefined;
    if (t) this.theme = t;
  }

  setGroup(g: string) {
    if (g === this.ui.group) return;
    this.ui.group = g;
    if (this.theme.group !== g) this.theme = this.catalog.themes.find((t) => t.group === g)!;
    this.ui.themeId = this.theme.id;
    store.set(`fm-layer-${this.mapset?.id ?? 'all'}`, this.theme.id);
    this.applyTheme();
  }

  setTheme(id: string) {
    if (id === this.theme.id) return;
    this.theme = this.catalog.themes.find((t) => t.id === id)!;
    this.ui.themeId = id;
    store.set(`fm-layer-${this.mapset?.id ?? 'all'}`, id);
    this.applyTheme();
  }

  setShadows(on: boolean) {
    this.ui.shadows = on;
    if (this.layer) this.layer.shadows = on;
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
    this.layer?.setMode(this.ui.mode);
    this.repaintAll(animate);
    this.renderRing();
    this.renderLegend();
    this.renderFlat();
    if (this.map.getLayer('fm-flat-selected')) this.map.setPaintProperty('fm-flat-selected', 'line-color', LOOKS[this.ui.mode].accent);
  }

  // ---- UI state -------------------------------------------------------------------------------------------------------
  private renderLayers() {
    this.ui.layers = this.catalog.themes.filter((t) => t.group === this.ui.group).map((t) => ({ id: t.id, name: t.name, ramp: ramp(legendColors(t, this.ui.palette)) }));
  }

  private renderLegend() {
    const legendUi = this.ui.legend;
    legendUi.title = this.theme.name;
    legendUi.note = this.theme.note ?? '';
    if (this.theme.area) {
      // an area layer: the database legend, no counts (it counts meldingen per area, not buildings)
      legendUi.total = '';
      legendUi.message = '';
      legendUi.note = this.theme.note ?? `${legendTitle(this.theme.area)}, zichtbaar tot zoomniveau 14.`;
      legendUi.sections = [{ title: '', rows: legendRows(this.theme.area).map((r) => ({ color: toHex(r.color), name: r.name, count: '', width: 0, empty: false })) }];
      return;
    }
    if (!this.result) {
      legendUi.total = '';
      legendUi.sections = [];
      // with the ownership filter on, tiles that arrived with nothing of the organisation in them are an answer
      legendUi.message = this.map.getZoom() < MIN_ZOOM_3D ? 'Zoom in voor de panden'
        : this.ui.ownerOnly && this.data.outside.size ? `Geen panden van ${this.ui.owner} in beeld.` : 'Gegevens laden…';
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
    const loading = [...this.entries.values()].filter((e) => e.state === 'loading').length + this.queue.length + this.data.loading + (this.walking ? 1 : 0) + (this.loading3d ? 1 : 0);
    const panden = ready.reduce((s, e) => s + (e.view?.tile.buildings ?? 0), 0);
    const mb = ready.reduce((s, e) => s + (e.view?.tile.bytes ?? 0), 0) / 1e6;
    let text: string;
    if (this.wantFlat) text = this.map.getZoom() < 13 ? 'Zoom in voor de panden' : 'Panden in 2D';
    else if (this.flat) text = '3D-modellen niet bereikbaar · panden als blokken';
    // the 3D engine itself is on its way (the first time the 3D view is shown)
    else if (this.loading3d) text = '3D-panden laden…';
    else if (this.map.getZoom() < MIN_ZOOM_3D) text = 'Zoom in om de panden in 3D te laden';
    else if (loading) text = `3D-panden laden… ${nf.format(panden)} in beeld`;
    else text = `${nf.format(panden)} panden in 3D${this.layer?.treeCount ? ` · ${nf.format(this.layer.treeCount)} bomen` : ''} · ${ready.length} tegels · ${nf1.format(mb)} MB`;
    this.ui.status = { text, busy: loading > 0 };
  }

  /** the legend row a building falls in for the active layer */
  private valueOf(b: number, pand?: string): { color: number; label: string; title: string } {
    const neutral = NEUTRAL[this.ui.mode].noData;
    if (b < 0 && pand && this.data.outside.has(pand)) return { color: neutral, label: this.ui.ownerOnly ? 'Niet in de selectie (eigendom of gebied)' : 'Buiten het gebied van deze kaart', title: this.theme.name };
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
    const f = hit.view.tile.features[hit.feature];
    this.tooltipFor(b, p, f, x, y, f.id);
  }

  /** f = the 3D BAG feature, null in flat mode */
  private tooltipFor(b: number, p: Props, f: TileFeature | null, x: number, y: number, pand: string) {
    const v = this.valueOf(b, pand);
    const height = heightOf(f, p);
    const rel = p.foundation_type_reliability ? L.RELIABILITY[String(p.foundation_type_reliability)] ?? String(p.foundation_type_reliability) : null;
    // a guest gets what the public map already says with its colour, and the BAG's own facts: nothing more of ours
    if (!this.isUser) p = {};
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
      title: b >= 0 || !this.isUser ? 'Pand' : 'Pand zonder FunderMaps-gegevens',
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
      p = b >= 0 ? this.data.buildings[b] : this.data.outside.has(pandId) ? {} : this.flatSelected.props;
    } else {
      this.ui.info = null;
      return;
    }
    const v = this.valueOf(b, pandId);
    // a guest's card: the address, the active layer's value (the colour on the map) and the BAG's own facts. Our data
    // on the building is for a logged-in user, in the building panel.
    if (!this.isUser) p = {};
    const rel = (k: string) => (p[k] ? ` · ${L.RELIABILITY[String(p[k])] ?? String(p[k])}` : '');
    const height = heightOf(f, p);
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
      stats: !this.isUser ? [] : [
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

/** a building from the address (pand number or an old gfm id) → its pand number and where it is (our geocoder) */
async function locate(id: string, signal?: AbortSignal): Promise<{ pand: string; lon: number; lat: number } | null> {
  // a pand number, or what the current map put in its links after an address search: the address's own BAG number
  const info = await buildingInfo(bagId(id) ?? id, signal);
  if (!info?.building_id || typeof info.building_lon !== 'number' || typeof info.building_lat !== 'number') return null;
  return { pand: info.building_id.slice(-16), lon: info.building_lon, lat: info.building_lat };
}

/** ridge height above ground from 3D BAG, else the height in our own data */
function heightOf(f: TileFeature | null, p: Props): number | null {
  if (f && f.ridgeHeight !== null && f.groundLevel !== null) return f.ridgeHeight - f.groundLevel;
  return typeof p.height === 'number' ? p.height : null;
}
