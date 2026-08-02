# gifsync

Combine an image (photo, GIF, or animated WebP) with a music file into a
downloadable MP4 video. Everything runs in your browser — no upload, no server.

## Browser support

**Use Chrome or Edge** (or Safari 17+). Animated-image decoding uses the
WebCodecs `ImageDecoder` API, which Firefox does not fully support.

## Develop

```
pnpm install
pnpm dev
```

## Shuffle (dev only)

`pnpm dev` adds a "Surprise me" button that loads a random gif and track from
two local folders. It only exists under `pnpm dev` — a production build has
no `/pool` endpoint, so the button staying hidden there is by design, not a
bug.

Create and populate `music/` yourself; it's gitignored, and pixabay can't be
fetched at runtime (CORP/COEP, a Cloudflare bot gate, and no music API), so
download tracks by hand from <https://pixabay.com/music/search/lofi/>. Name a
track `Title — Artist.mp3` (em dash, spaces both sides) to show the artist in
the UI; otherwise the filename is de-slugged into a title. `GIF_DIR` in
`vite.config.ts` is a hardcoded absolute path into a different repo — edit it
on any other machine. `ffprobe` on `PATH` is optional: it reads embedded tags
when present, and labelling falls back to the filename without it.

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
`@ffmpeg/core-mt` fails to load. Configure them in your host's headers file
(e.g. Netlify `_headers`, Vercel `vercel.json`). The fallback is the
single-threaded `@ffmpeg/core` package — remove the `workerURL` from the
`ffmpeg.load()` call in `src/encode.ts` if you need to target hosts that
cannot set these headers.

Node 18+ is required to build. The `.nvmrc` pins `lts/*`; run `nvm use` before
`pnpm install` / `pnpm build`.
