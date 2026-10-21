# FunderMaps map (5.0)

The customer map of FunderMaps in 3D: every building of the Netherlands as its 3D BAG model, coloured by its
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
- **Shapes:** 3D BAG Cesium 3D Tiles (LoD 2.2) from `data.3dbag.nl`. The browser walks the 3D BAG tileset for the area
  in view (`src/engine/bag3d-tileset.ts`) and converts the tiles in Web Workers (`src/engine/tiles.ts`).
- **FunderMaps data:** our own `buildings` vector tiles (Martin) at zoom 14, where every building carries every field.
  A worker decodes only the properties (`src/data/`); they are joined to the 3D BAG features on the 16-digit BAG pand
  number.
- **Colours** are the current map app's own layer rules and the database legends (`src/engine/rules.json`,
  `legends.json`), evaluated with MapLibre's style-spec engine, optionally in the 2026 palette.
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
| `VITE_BAG3D_URL` | `https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/` |

## Attribution

3D building models: [3DBAG](https://3dbag.nl) by the 3D geoinformation group of TU Delft and 3DGI, CC BY 4.0.
