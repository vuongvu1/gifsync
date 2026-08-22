import { defineConfig } from "vite";

// One HTML entry per tool (Vite multi-page). Keeping them separate means the
// homepage and the timestamp tool never pull in the ffmpeg.wasm chunks.
// `import.meta.url` stands in for __dirname — this config is ESM and the
// project has no Node type definitions.
const page = (name: string) => new URL(name, import.meta.url).pathname;

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: page("index.html"),
        gifsync: page("gifsync/index.html"),
        ytstamp: page("ytstamp/index.html"),
      },
    },
  },

  // ffmpeg.wasm spawns its worker via `new Worker(new URL("./worker.js",
  // import.meta.url))`. If Vite pre-bundles the package, import.meta.url points
  // into .vite/deps/ where worker.js doesn't exist → 404. Excluding it serves
  // the real package ESM so the relative worker URL resolves.
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  // COOP/COEP required so ffmpeg.wasm (core-mt) can use SharedArrayBuffer.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
