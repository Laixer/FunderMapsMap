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
- **Mapsets and links:** `/map/<mapset>` opens a public mapset from the API (`/api/mapset/<id or slug>`): its layer
  set, note, disclaimer, centre and fence. `/map/<mapset>/building/<pand id>(/<panel>)` opens a building on it; the
  current map app's old forms (`/kaart/…`, `…/gebouw/…`) and `?lat=…&lng=…` work too. The camera is in the hash
  (`src/map/route.ts`).
- **Search:** PDOK Locatieserver for the whole country; the API's public building lookup gives the address of a
  selected building.

No private data lives in this repository or the bundle.

## Settings (build time)

| Variable | Default |
|---|---|
| `VITE_TILESERVER_URL` | `https://tiles.fundermaps.com` |
| `VITE_BASEMAP_STYLE` | `<tileserver>/style/fundermaps-basemap` |
| `VITE_API_URL` | `https://api.fundermaps.com` |
| `VITE_PDOK_LOCATIONSERVICE` | `https://api.pdok.nl/bzk/locatieserver/search/v3_1` |
| `VITE_3D_URL` | `https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/gebouwen/` |
| `VITE_3D_ROOT` | `3dtiles?f=json` (3D BAG: `tileset.json`) |
| `VITE_3D_ATTRIBUTION` | the 3D Basisvoorziening credit line |

## Attribution

3D building models: [3D Basisvoorziening](https://www.pdok.nl/introductie/-/article/3d-basisvoorziening) by Kadaster via PDOK,
CC BY 4.0. (Alternative source: [3DBAG](https://3dbag.nl), TU Delft 3D geoinformation and 3DGI, CC BY 4.0.)
