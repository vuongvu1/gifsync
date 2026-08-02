# Shuffle button — random gif + track — design

Date: 2026-08-02

## Goal

A "Surprise me" button that picks a random image and a random music track from
local pools, loads them into the existing image/audio slots, and renders the
normal preview. If the roll is bad, click again. If it is good, hit Generate as
usual. Nothing about the encode path changes.

Dev-only. The deployed static site keeps the two file pickers and hides the
button.

## Constraints discovered

**Pixabay cannot be fetched at runtime.** Three independent blocks:

- `pixabay.com` responds with `Cross-Origin-Resource-Policy: same-origin`, and
  gifsync runs under `Cross-Origin-Embedder-Policy: require-corp` (required for
  `SharedArrayBuffer` / `@ffmpeg/core-mt`). Cross-origin embed is refused.
- `https://pixabay.com/music/search/lofi/` returns `403` with
  `cf-mitigated: challenge` — a Cloudflare bot gate. This also defeats a
  server-side proxy.
- The public Pixabay API covers images and videos only. There is no music
  endpoint.

So tracks are curated by hand: download from pixabay into a local folder once.

**The gif pool is large and lives in another repo.**
`/Users/vuhoangvuong/WORKSPACE/personal/late-night-vibes/src/assets/gifs`
holds 671 files (514 `.gif`, 157 `.webp`), ~1.4 GB. It cannot enter the Vite
build graph or a deploy. It is read at dev time only.

**Pixabay mp3s carry no metadata.** Existing pixabay downloads in
`late-night-vibes` start with an MPEG frame sync (`fffb`) and have no `ID3`
header; `ffprobe -show_entries format_tags` returns nothing. Track author is
therefore usually unavailable from the file itself.

## Approach (chosen)

### Pool endpoint — `vite.config.ts`

A `configureServer` middleware, so the production build is untouched and no
prod code path exists to maintain.

- `server.fs.allow: [".", GIF_DIR]` — `"."` is Vite's own default for this
  repo and grants nothing extra; `GIF_DIR` is the only addition needed to serve
  the gifs. Vite's built-in `/@fs/<abspath>` handler does the rest, including
  setting the right `Content-Type`. No file-serving code is written.
- `GET /pool` → `{ gifs: string[], tracks: Track[] }`, absolute paths from
  `readdirSync`, filtered by extension (`.gif`, `.webp` / `.mp3`, `.m4a`,
  `.ogg`, `.wav`).
- `GIF_DIR` is a hardcoded absolute constant. Deliberate: personal tool, one
  machine.
- Music pool is `./music` in the gifsync root, gitignored. Already inside the
  Vite root, so it needs no `fs.allow` entry.

Correct MIME from `/@fs/` matters beyond cosmetics: `buildInput` in `main.ts`
branches on `image.type === "image/gif" || "image/webp"` to choose the animated
path, and that type comes from the fetched `blob.type`.

### Track labelling

Resolved server-side at listing time, three tiers:

1. `ffprobe -v error -show_entries format_tags=title,artist -of json <file>`.
   Five lines, handles ID3/m4a/ogg uniformly. `ffprobe` is already installed
   (`/opt/homebrew/bin/ffprobe`) and this repo is an ffmpeg project. Rejected a
   hand-rolled ID3v2 parser: ~35 lines that only pay off on a machine without
   ffmpeg.
2. Filename convention `Title — Artist.mp3`, split on ` — `. This is the
   load-bearing tier given that pixabay strips tags — rename on download and it
   always works, at zero code cost.
3. Bare pixabay slug `relaxing-piano-music-248868.mp3` → strip the trailing
   numeric id, de-slug, title-case → `Relaxing Piano Music`, no artist.

`Track = { path: string; title: string; artist?: string }`.

Displayed in the music drop as `Title — Artist`, or `Title` alone when there is
no artist.

### Client — `src/shuffle.ts`

```ts
export type Track = { path: string; title: string; artist?: string };
export type Pool = { gifs: string[]; tracks: Track[] };

export function loadPool(): Promise<Pool>;          // fetch("/pool")
export function pick<T>(items: T[]): T;             // uniform random
export function fetchAsFile(absPath: string): Promise<File>;
```

`fetchAsFile` does `fetch("/@fs" + absPath)` → `blob()` → `new File([blob],
basename(absPath), { type: blob.type })`.

### Wiring — `src/main.ts`

- A `<button id="shuffle">🎲 Surprise me</button>` above the drops, and a
  `<span class="name">` inside the music drop label. The span is necessary
  because the label already contains the hidden `<input>`; writing
  `textContent` on the label directly would remove it.
- On boot, `loadPool()`. Any failure or an empty pool sets
  `shuffleBtn.hidden = true`. That single `catch` is the entire production
  story — the built site 404s on `/pool` and the button never appears.
- On click: disable the button, `pick()` from each list, `fetchAsFile` both in
  parallel, assign `imageFile` / `audioFile`, write the track label, then call
  the existing `refresh()` and `updateResLabel()`.

Reusing `refresh()` means preview, visualizer attach, watermark attach, and the
Generate button's enabled state all update through the path they already use
for manual file selection.

## Error handling

- `/pool` unreachable, malformed, or empty → button hidden, no error surfaced.
  Absence of the pool is the normal production state, not a fault.
- A file fetch failing mid-roll → message into `statusEl` with
  `class="error"`, button re-enabled, previous selection left intact.
- `ffprobe` missing or failing on a track → that track falls through to the
  filename tiers. Listing never fails because of a bad tag read.

## Testing

`src/shuffle.test.ts`, with `fetch` stubbed:

- `fetchAsFile` returns a `File` with the basename as its name and the
  response's content type, for a `.gif`, a `.webp`, and an `.mp3`.
- `pick` only ever returns an element of the input array, and throws on empty.
- Track labelling: tags present → `Title — Artist`; ` — ` filename → split
  correctly; bare pixabay slug → de-slugged title with no artist.

The labelling fallback chain is the only non-trivial branch here, so it is what
the tests are actually protecting.

## Not building

- Repeat-avoidance history across rolls.
- Per-slot dice or lock toggles — one button rolls both.
- A gif filename label — display was scoped to the track.
- Any production asset hosting or pixabay integration.
