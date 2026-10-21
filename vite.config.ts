import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(() => {
  try {
    process.env.VITE_GIT_COMMIT_HASH = execSync('git rev-parse --short HEAD').toString().trimEnd();
  } catch {
    process.env.VITE_GIT_COMMIT_HASH = 'unknown';
  }

  // A build id in every file name: during a deploy the static host's catch-all can answer a chunk URL that does not
  // exist (yet) with index.html, and the CDN then caches that HTML under the .js URL for a day. Fresh names per build
  // mean a poisoned URL is never asked for again (same fix as the current map app).
  const buildId = Date.now().toString(36);
  const names = {
    entryFileNames: `assets/[name]-[hash]-${buildId}.js`,
    chunkFileNames: `assets/[name]-[hash]-${buildId}.js`,
    assetFileNames: `assets/[name]-[hash]-${buildId}[extname]`,
  };

  return {
    plugins: [vue()],
    resolve: {
      alias: [{ find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) }],
    },
    worker: {
      format: 'es' as const,
      rollupOptions: { output: names },
    },
    build: {
      // maplibre-gl (~1.5 MB) and three (~0.7 MB) are the floor of the bundle, each in its own chunk
      chunkSizeWarningLimit: 1800,
      rollupOptions: {
        output: {
          ...names,
          manualChunks(id: string) {
            if (id.includes('maplibre-gl')) return 'maplibre-gl';
            if (id.includes('node_modules/three')) return 'three';
          },
        },
      },
    },
  };
});
