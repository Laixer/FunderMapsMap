// The map's addresses, the same as the current map app's (WebFront router/index.ts) so old links keep working:
//   /map/:mapset                              a mapset (id or slug)
//   /map/:mapset/building/:id(/:panel)        a building on it (id: NL.IMBAG.PAND.… or the 16 digits)
//   /kaart/:mapset(…), …/gebouw/…             old forms, rewritten to the above
//   ?lat=…&lng=…                              where to look (the map's own #zoom/lat/lng/bearing/pitch wins)
// The camera position lives in the hash (MapLibre), which every change here keeps.
export interface Route {
  mapset: string | null;
  /** the 16-digit pand number, or an id the geocoder resolves (an old gfm id) */
  building: string | null;
  /** a panel of the building card; kept in the address, the card has no panels yet */
  panel: string | null;
  lat: number | null;
  lng: number | null;
}

/** the 16-digit pand number of NL.IMBAG.PAND.0599100000761761, 0599100000761761 or 599100000761761; null otherwise */
export function pandNumber(id: string): string | null {
  const m = /^(?:NL\.IMBAG\.PAND\.)?(\d{15,16})$/i.exec(id.trim());
  return m ? m[1].padStart(16, '0') : null;
}

export function parseRoute(loc: { pathname: string; search: string } = location): Route {
  const parts = loc.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const q = new URLSearchParams(loc.search);
  const num = (k: string) => { const v = Number.parseFloat(q.get(k) ?? ''); return Number.isFinite(v) ? v : null; };
  const route: Route = { mapset: null, building: null, panel: null, lat: num('lat'), lng: num('lng') };
  if ((parts[0] === 'map' || parts[0] === 'kaart') && parts[1]) {
    route.mapset = parts[1];
    if ((parts[2] === 'building' || parts[2] === 'gebouw') && parts[3]) {
      route.building = pandNumber(parts[3]) ?? parts[3];
      route.panel = parts[4] ?? null;
    }
  }
  return route;
}

export function routePath(r: Pick<Route, 'mapset' | 'building' | 'panel'>): string {
  if (!r.mapset) return '/';
  const base = `/map/${encodeURIComponent(r.mapset)}`;
  if (!r.building) return base;
  const id = /^\d{16}$/.test(r.building) ? `NL.IMBAG.PAND.${r.building}` : encodeURIComponent(r.building);
  return `${base}/building/${id}${r.panel ? `/${encodeURIComponent(r.panel)}` : ''}`;
}

/** the address with this route, keeping the hash (camera) and dropping ?lat&lng once the hash holds the camera */
function href(r: Route): string {
  const q = new URLSearchParams(location.search);
  if (location.hash.length > 1) { q.delete('lat'); q.delete('lng'); }
  const search = q.toString();
  return `${routePath(r)}${search ? `?${search}` : ''}${location.hash}`;
}

/** write the route: a new history entry when the building changes (Back closes it), otherwise in place */
export function writeRoute(r: Route, push: boolean) {
  const next = href(r);
  if (next === `${location.pathname}${location.search}${location.hash}`) return;
  if (push) history.pushState(history.state, '', next);
  else history.replaceState(history.state, '', next);
}
