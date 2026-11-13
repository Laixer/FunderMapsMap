# FunderMaps map (5.0)

The customer map of FunderMaps in 3D: every building of the Netherlands as its 3D model, coloured by its
foundation type, repair, subsidence and foundation risk. It grows out of the 3D prototype of October 2026 and replaces
the current map app (FunderMapsWebFront) once it does everything that app does.

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # type check + production build into dist/
```

## How it works

- **MapLibre** draws the basemap (`tiles.fundermaps.com/style/fundermaps-basemap`, restyled light or dark), labels and
  controls. A MapLibre custom layer runs **three.js** to draw the buildings (`src/engine/scene.ts`): sun and sky light,
  crease lines, sun shadows, selection, hover.
- **Shapes:** Cesium 3D Tiles 1.1 of PDOK 3D Basisvoorziening (Kadaster; LoD 2.2 made with roofer, the same software
  as 3D BAG; every building carries its BAG `identificatie`). The browser walks the tileset for the area in view
  (`src/engine/bag3d-tileset.ts`: region and box volumes, transforms down the tree) and converts the tiles in Web Workers
  (`src/engine/tiles.ts`). 3D BAG works as well (other base URL). When the 3D source cannot be reached the map falls
  back to **flat mode**: our own building tiles as blocks with the same colours.
- **FunderMaps data:** our own vector tiles (Martin) at zoom 14: `buildings` (every field per building), `facade_scan`
  and `incident`. A worker decodes only the properties and merges them per building (`src/data/`); they are joined to
  the 3D features on the 16-digit BAG pand number. Incidents per buurt, wijk and gemeente and the building blocks are
  drawn on the ground with the current map app's own layer specs (`src/config/area-layers.json`).
- **Colours** are the current map app's own layer rules and the database legends (`src/engine/rules.json`,
  `legends.json`, frozen by `tools/freeze-rules.py`), evaluated with MapLibre's style-spec engine, optionally in the
  2026 palette. An open mapset brings its own legends at runtime.
- **Ownership (layer `owner`, "Eigendom"):** hundreds of owners do not fit a legend, so this layer's rule and legend
  are made from the buildings loaded around the view (`updateOwners` in `src/engine/themes.ts`): the 12 owners with
  the most buildings get a colour and a legend row each, every other owner shares the row "Overig corporatiebezit", a
  building without an owner is not in the layer, and neither is one whose owner the data only calls "Particulier". An owner keeps its colour while the map moves. The layer shows when
  a mapset's layer set contains the layer id `owner`.
- **Mapsets and links:** `/map/<mapset>` opens a public mapset from the API (`/api/mapset/<id or slug>`): its layer
  set, note, disclaimer, centre and fence. `/map/<mapset>/building/<pand id>(/<panel>)` opens a building on it; the
  current map app's old forms (`/kaart/…`, `…/gebouw/…`) and `?lat=…&lng=…` work too. The camera is in the hash
  (`src/map/route.ts`).
- **Who sees what:** every view is a mapset's view, as on the current map; without a mapset there is no data on the
  map. A guest gets public mapsets only: the one in the address, else the public one looked at last, else the login
  page. A user gets the mapset in the address, else the one looked at last, else their first; an unknown or foreign
  one falls back to their own, with a note; without any mapset they are told so (`components/NoMapsets.vue`). Of a
  building a guest sees the address, the active layer's value (what the colour already says) and the BAG's own
  facts: nothing else of our data, not on the page and not in its state. The view with every layer of the country
  exists only for work on the layers (`pnpm dev`, or a build with `VITE_ALL_LAYERS=1`).
- **Login:** the session is the API's cookie (Better Auth), nothing of it is kept here. `src/api/session.ts` asks
  `/api/user/me` once; without a session the visitor is a guest. The login pages are the current map app's:
  `/login`, `/forgot-password`, `/reset-password`, `/account` (passkeys, sign-out), plus the profile and password
  dialogs behind the user menu (`src/pages/AuthPages.vue`, `src/api/auth.ts`). The cookie belongs to the login host's
  site, so on any other host name the map stays a guest's map and the login pages forward to `VITE_LOGIN_HOST`.
- **Contact:** the user menu ends with "Uw contactpersoon": the account holder of the user's organisation (set per
  organisation in the Studio's Beheer, sent with `/api/user/me`), with a mail and a phone link; without one, the general
  address (`VITE_CONTACT_EMAIL`). The map has no "organisation you are working in": someone in several organisations
  with different account holders sees each, with the organisation it is for (`src/api/contacts.ts`).
- **Building panel** (`src/panel/`): for a logged-in user, everything the current map app shows for a building, from
  the API's customer part: key facts, Pand, Locatie, Fundering, Funderingsrisico, Onderzoek and Herstel (with their
  samples and documents), Incidenten, the statistics of the neighbourhood (Chart.js, loaded with the dialog) and the
  PDF report. The view is in the address (`…/building/<pand>/<panel>`). Labels and enum texts are frozen from the
  current map app (`tools/freeze-labels.py` → `src/panel/labels.json`); enum values are matched by name. A guest keeps
  a card with the address and the way to log in (see "Who sees what"). The analysis and statistics calls are the billed
  ones, as today. Under each risk the Funderingsrisico view says "Waarom deze risico-indicatie?": what the letter rests
  on, as the model recorded it and the analysis sends it (`explanation`), worded in `src/panel/explanation.ts`.
- **A user's own mapsets:** with a login the organisation's mapsets come from `/api/mapset`; a picker in the panel
  switches between them, and an address without a mapset opens the one looked at last. "Filter op eigendom" keeps only
  the buildings whose owner in our tiles is the user's organisation.
- **Where you were:** the last position is remembered as the current map app does it (`src/map/position.ts`): with the
  account for a user (`/api/user/metadata`, the same keys), in the browser for a guest. A building or a position in
  the address wins.
- **3D or 2D:** the "3D-panden" switch chooses between the 3D models and a plain 2D map: our own building tiles as
  flat shapes, seen from straight above. The choice is remembered. Without a choice a phone and a device without a GPU
  start in 2D, everything else in 3D; `?view=3d|flat` tries the other once. When the 3D source cannot be reached the
  buildings stand up as blocks from the same tiles, so the map still reads as the 3D one.
- **Trees (a prototype):** in the 3D view, from zoom 15, every tree the BGT has registered stands on the map: the
  BGT's tree points from PDOK (`src/data/trees.ts`, per map cell, removed trees left out) drawn as one low-poly tree
  per point with instancing (`BuildingLayer.setTrees`), lit like the buildings and casting shadows. The BGT says where a
  tree stands, not how tall it is: the height drawn (6 to 15 m) is made up from the position, the same on every visit.
  A "Bomen" switch turns them off. Nothing is done with them yet beyond showing them.
- **Look:** dark unless the visitor chose light. Shadows, the surroundings and the 2026 colours are simply on. The page
  itself never scrolls (it is clipped): panels and the login pages scroll inside themselves.
- **Phone:** below 640 px the layer panel folds (and folds again when a building opens), the building's panel and
  card are sheets from the bottom, lists stack, touch targets are 40 px.
- **Keyboard:** the building panel takes the focus when it opens, each view moves it to its heading, Escape goes back
  a view and then closes the panel; dialogs are native `<dialog>`s.
- **Search:** a BAG number (pand, address or verblijfsobject, with or without `NL.IMBAG.…`) or an old gfm id opens
  that building; anything else is an address search: PDOK Locatieserver for the whole country; the API's public building lookup gives the address of a
  selected building.

No private data lives in this repository or the bundle.

## Settings (build time)

| Variable | Default |
|---|---|
| `VITE_TILESERVER_URL` | `https://tiles.fundermaps.com` |
| `VITE_BASEMAP_STYLE` | `<tileserver>/style/fundermaps-basemap` |
| `VITE_API_URL` | `https://api.fundermaps.com` |
| `VITE_LOGIN_HOST` | `https://maps.fundermaps.com` |
| `VITE_CONTACT_EMAIL` | `info@fundermaps.com` |
| `VITE_ALL_LAYERS` | unset; `1` shows every layer without a mapset (never for production) |
| `VITE_PDOK_LOCATIONSERVICE` | `https://api.pdok.nl/bzk/locatieserver/search/v3_1` |
| `VITE_3D_URL` | `https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/gebouwen/` |
| `VITE_3D_ROOT` | `3dtiles?f=json` (3D BAG: `tileset.json`) |
| `VITE_3D_ATTRIBUTION` | the 3D Basisvoorziening credit line |

## Attribution

3D building models: [3D Basisvoorziening](https://www.pdok.nl/introductie/-/article/3d-basisvoorziening) by Kadaster via PDOK,
CC BY 4.0. (Alternative source: [3DBAG](https://3dbag.nl), TU Delft 3D geoinformation and 3DGI, CC BY 4.0.)
