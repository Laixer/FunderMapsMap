// Addresses the map talks to. Each can be set at build time (VITE_*); the defaults are production.
const env = import.meta.env;

export const TILESERVER = (env.VITE_TILESERVER_URL ?? 'https://tiles.fundermaps.com').replace(/\/$/, '');
export const BASEMAP = env.VITE_BASEMAP_STYLE ?? `${TILESERVER}/style/fundermaps-basemap`;
export const API = (env.VITE_API_URL ?? 'https://api.fundermaps.com').replace(/\/$/, '');
export const PDOK = (env.VITE_PDOK_LOCATIONSERVICE ?? 'https://api.pdok.nl/bzk/locatieserver/search/v3_1').replace(/\/$/, '');
/**
 * The 3D building models (Cesium 3D Tiles 1.1, walked by the browser: engine/bag3d-tileset.ts). Default: PDOK 3D
 * Basisvoorziening (Kadaster). 3D BAG works too: VITE_3D_URL=https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/,
 * VITE_3D_ROOT=tileset.json, and its own attribution. A mirror of ours is one more base URL.
 */
export const BUILDINGS_3D = {
  base: env.VITE_3D_URL ?? 'https://api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1/collections/gebouwen/',
  root: env.VITE_3D_ROOT ?? '3dtiles?f=json',
  attribution: env.VITE_3D_ATTRIBUTION ??
    '3D-panden <a href="https://www.pdok.nl/introductie/-/article/3d-basisvoorziening" target="_blank" rel="noopener">3D Basisvoorziening</a> (Kadaster), CC BY 4.0',
};
export const COMMIT = env.VITE_GIT_COMMIT_HASH ?? 'dev';
