import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Plugin, defineConfig } from "vite";
import { trackMeta } from "./src/track-label";

// Shuffle pools. Hardcoded absolute paths: dev-only convenience on one
// machine. The gif folder lives in another repo and is ~1.4 GB, so it must
// never enter the build graph — hence `apply: "serve"` on the plugin below.
const GIF_DIR = "/Users/vuhoangvuong/WORKSPACE/personal/late-night-vibes/src/assets/gifs";
const MUSIC_DIR = "/Users/vuhoangvuong/WORKSPACE/personal/gifsync/music";

const IMAGE_EXT = /\.(gif|webp)$/i;
const AUDIO_EXT = /\.(mp3|m4a|ogg|wav|flac)$/i;

function list(dir: string, match: RegExp): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => match.test(f))
      .sort()
      .map((f) => join(dir, f));
  } catch (err) {
    console.warn(`[gifsync-pool] could not list directory "${dir}":`, err);
    return []; // missing folder → empty pool → the client hides the button
  }
}

// Shelling out to ffprobe beats hand-rolling an ID3 parser in an ffmpeg
// project, and it covers m4a/ogg/flac too. Pixabay strips tags, so in practice
// this returns nothing and trackMeta() falls back to the filename.
function readTags(path: string): { title?: string; artist?: string } {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format_tags=title,artist", "-of", "json", path],
      { encoding: "utf8", timeout: 5000 },
    );
    return JSON.parse(out).format?.tags ?? {};
  } catch (err) {
    console.warn(`[gifsync-pool] could not read tags for "${path}":`, err);
    return {}; // ffprobe missing or unreadable file → filename fallback
  }
}

function poolPlugin(): Plugin {
  return {
    name: "gifsync-pool",
    apply: "serve",
    // Registering directly (rather than returning a function) installs this
    // ahead of the transform, static-serve and SPA-fallback middlewares, so
    // the fallback can't swallow /pool and answer it with index.html. It
    // still runs behind Vite's request-validation, CORS and host-validation
    // middlewares, so /pool inherits those protections.
    configureServer(server) {
      server.middlewares.use("/pool", (_req, res) => {
        const gifs = list(GIF_DIR, IMAGE_EXT);
        const tracks = list(MUSIC_DIR, AUDIO_EXT).map((path) => ({
          path,
          ...trackMeta(path.slice(path.lastIndexOf("/") + 1), readTags(path)),
        }));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ gifs, tracks }));
      });
    },
  };
}

// COOP/COEP required so ffmpeg.wasm (core-mt) can use SharedArrayBuffer.
export default defineConfig({
  plugins: [poolPlugin()],
  // ffmpeg.wasm spawns its worker via `new Worker(new URL("./worker.js",
  // import.meta.url))`. If Vite pre-bundles the package, import.meta.url points
  // into .vite/deps/ where worker.js doesn't exist → 404. Excluding it serves
  // the real package ESM so the relative worker URL resolves.
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  server: {
    // "." keeps the project root servable (the default); GIF_DIR lets Vite's
    // /@fs handler reach the out-of-root pool.
    fs: { allow: [".", GIF_DIR] },
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
