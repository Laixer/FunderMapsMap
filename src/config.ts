// Addresses the map talks to. Each can be set at build time (VITE_*); the defaults are production.
const env = import.meta.env;

export const TILESERVER = (env.VITE_TILESERVER_URL ?? 'https://tiles.fundermaps.com').replace(/\/$/, '');
export const BASEMAP = env.VITE_BASEMAP_STYLE ?? `${TILESERVER}/style/fundermaps-basemap`;
export const API = (env.VITE_API_URL ?? 'https://api.fundermaps.com').replace(/\/$/, '');
export const PDOK = (env.VITE_PDOK_LOCATIONSERVICE ?? 'https://api.pdok.nl/bzk/locatieserver/search/v3_1').replace(/\/$/, '');
/** the national 3D BAG leaf-tile index, built by tools/3dbag-index.py */
export const BAG3D_INDEX = `${import.meta.env.BASE_URL}3dbag/v20250903-lod22.json`;
export const COMMIT = env.VITE_GIT_COMMIT_HASH ?? 'dev';
