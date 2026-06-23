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
