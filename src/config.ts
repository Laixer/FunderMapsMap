// Addresses the map talks to. Each can be set at build time (VITE_*); the defaults are production.
const env = import.meta.env;

export const TILESERVER = (env.VITE_TILESERVER_URL ?? 'https://tiles.fundermaps.com').replace(/\/$/, '');
export const BASEMAP = env.VITE_BASEMAP_STYLE ?? `${TILESERVER}/style/fundermaps-basemap`;
export const API = (env.VITE_API_URL ?? 'https://api.fundermaps.com').replace(/\/$/, '');
export const PDOK = (env.VITE_PDOK_LOCATIONSERVICE ?? 'https://api.pdok.nl/bzk/locatieserver/search/v3_1').replace(/\/$/, '');
/** 3D BAG Cesium 3D Tiles (LoD 2.2), walked by the browser (engine/bag3d-tileset.ts) */
export const BAG3D = env.VITE_BAG3D_URL ?? 'https://data.3dbag.nl/v20250903/cesium3dtiles/lod22/';
export const COMMIT = env.VITE_GIT_COMMIT_HASH ?? 'dev';
