/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Martin tileserver base, e.g. https://tiles.fundermaps.com */
  readonly VITE_TILESERVER_URL?: string;
  /** basemap style URL */
  readonly VITE_BASEMAP_STYLE?: string;
  /** FunderMaps API base (public building lookup now; login later), e.g. https://api.fundermaps.com */
  readonly VITE_API_URL?: string;
  /** 3D BAG Cesium 3D Tiles base (ending in /), e.g. a mirror */
  readonly VITE_BAG3D_URL?: string;
  /** PDOK Locatieserver base */
  readonly VITE_PDOK_LOCATIONSERVICE?: string;
  readonly VITE_GIT_COMMIT_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
