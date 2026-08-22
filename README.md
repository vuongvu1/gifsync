# tools

A small collection of single-purpose browser utilities. Everything runs
client-side — nothing is uploaded.

| Page | Tool | What it does |
| --- | --- | --- |
| `/` | index | Lists the tools |
| `/gifsync/` | **gifsync** | Combines an image (photo, GIF, or animated WebP) with a music file into a downloadable MP4, with an audio visualizer and a watermark |
| `/ytstamp/` | **live timestamp** | Turns a YouTube player's "Copy debug info" blob into a watch link pointing at the moment it was copied |

Each tool is its own Vite HTML entry (see `build.rollupOptions.input` in
`vite.config.ts`), so the index and the timestamp tool never download the
ffmpeg.wasm chunks.

## live timestamp

There is no way to share a timestamp while a stream is still live. This tool
reads the player's debug info instead: `docid` is the video, `cmt` is the
playhead in seconds from the start of the stream, and `lio` is the epoch second
of media time 0 — so `lio + cmt` is when the marked frame actually aired (a few
seconds before the copy, by the live latency in `lat`). The resulting
`watch?v=…&t=…s` link resolves once the DVR window or the archive is available.

The parser falls back to a per-key scan when the pasted text isn't valid JSON,
which a truncated or dirty copy often isn't.

## Browser support

**Use Chrome or Edge** (or Safari 17+) for gifsync. Animated-image decoding uses
the WebCodecs `ImageDecoder` API, which Firefox does not fully support. The
timestamp tool works anywhere.

## Develop

```
pnpm install
pnpm dev
```

## Test

```
pnpm test
```

## Deploy

The static host **must** send these two headers on every response:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them `SharedArrayBuffer` is unavailable and the multithreaded
`@ffmpeg/core-mt` fails to load — gifsync breaks; the other pages are
unaffected. Configure them in your host's headers file (`public/_headers` covers
Cloudflare Pages and Netlify; Vercel uses `vercel.json`). The fallback is the
single-threaded `@ffmpeg/core` package — remove the `workerURL` from the
`ffmpeg.load()` call in `src/encode.ts` if you need to target hosts that cannot
set these headers.

Node 18+ is required to build. The `.nvmrc` pins `lts/*`; run `nvm use` before
`pnpm install` / `pnpm build`.
