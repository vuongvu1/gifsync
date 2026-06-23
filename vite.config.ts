import { defineConfig } from "vite";

// COOP/COEP required so ffmpeg.wasm (core-mt) can use SharedArrayBuffer.
export default defineConfig({
  // ffmpeg.wasm spawns its worker via `new Worker(new URL("./worker.js",
  // import.meta.url))`. If Vite pre-bundles the package, import.meta.url points
  // into .vite/deps/ where worker.js doesn't exist → 404. Excluding it serves
  // the real package ESM so the relative worker URL resolves.
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
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
