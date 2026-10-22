/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Martin tileserver base, e.g. https://tiles.fundermaps.com */
  readonly VITE_TILESERVER_URL?: string;
  /** basemap style URL */
  readonly VITE_BASEMAP_STYLE?: string;
  /** FunderMaps API base (public building lookup now; login later), e.g. https://api.fundermaps.com */
  readonly VITE_API_URL?: string;
  /** 3D building tiles: base URL (ending in /), root document under it, and the attribution line */
  readonly VITE_3D_URL?: string;
  readonly VITE_3D_ROOT?: string;
  readonly VITE_3D_ATTRIBUTION?: string;
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
