# gifsync — Design

**Date:** 2026-06-23
**Status:** Approved, ready for implementation plan

## Purpose

A browser-only web app that combines one image (photo, GIF, or animated/static
WebP) with one music file into a downloadable MP4 video. No backend: all
encoding happens in the user's browser. Files never leave the machine.

## User flow

1. User drops/selects an **image** (JPEG, PNG, static WebP, GIF, animated WebP).
2. User drops/selects an **audio** file (MP3, etc.).
3. A **live preview** shows the image (animated ones play natively) with the
   audio playing alongside, so the user can check it before exporting.
4. User clicks **Generate**. A progress bar tracks encoding.
5. A **download** link delivers the finished `.mp4`. Files are kept on screen so
   the user can re-generate or swap one input.

## Output spec

- **Duration = full audio length.**
  - Static image (photo / static WebP): held still for the whole audio.
  - Animated image (GIF / animated WebP): animation loops to fill the audio.
- **Container/codec:** MP4, H.264 video + AAC audio (max compatibility).
- **Resolution:** image's native dimensions, scaled to even width/height
  (H.264 requires dimensions divisible by 2).

## Architecture

Browser-only. Static site. Two pieces of machinery:

1. **ffmpeg.wasm** — assembles frames + audio into the final H.264/AAC MP4.
2. **WebCodecs `ImageDecoder`** — splits animated GIF/WebP into individual
   still frames *in the browser*, because ffmpeg.wasm's animated-WebP demuxer is
   unreliable. The browser decodes animated WebP/GIF natively and correctly.

### Why browser-decode for animated input

ffmpeg.wasm cannot reliably read animated WebP. Rather than fall back to a
single static frame (explicitly rejected), the browser extracts every frame
plus its per-frame duration, then hands plain PNG frames to ffmpeg — which is
reliable at turning a frame sequence + audio into MP4.

### Browser-support constraint

`WebCodecs ImageDecoder` is supported in Chromium (Chrome/Edge) and Safari 17+,
and is only partial in Firefox. This makes the app **Chromium-recommended**.

- A **visible note in the UI** states: "Works best in Chrome/Edge. Firefox may
  not decode animated images."
- The same note goes in the README.

## Stack

Vite + vanilla TypeScript.

- Vite dev server sets the COOP/COEP cross-origin-isolation headers that
  multithreaded ffmpeg.wasm needs for `SharedArrayBuffer`.
- One build, one `index.html`, a handful of focused source files.
- No framework — single screen doesn't justify React.
- **Deploy note:** the static host must also send
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`, or fall back to the
  single-threaded ffmpeg core.

## Modules

Each file has one clear job and a defined boundary.

- **`main.ts`** — DOM wiring and app state. Holds the two selected files + status
  (idle / encoding / done / error), enables Generate only when both files
  present, orchestrates preview → decode → encode → download.
- **`preview.ts`** — renders the dropped image (animated ones play natively) and
  syncs playback with an `<audio>` element. Pure DOM, no ffmpeg, no decode.
- **`decode.ts`** — WebCodecs `ImageDecoder`. Input: an animated image file.
  Output: ordered array of `{ pngBytes, durationMs }` frames. Used for animated
  input only.
- **`encode.ts`** — owns ffmpeg.wasm. Loads the core, builds the argument list
  and (for animated input) the concat list, runs ffmpeg, returns an MP4 `Blob`.
  Reports progress via ffmpeg's `progress` event.
- **`index.html` + `style.css`** — two drop zones, audio player/preview area,
  Generate button, progress bar, download link, and the browser-support note.

## Encode logic (the core)

### Static image
```
ffmpeg -loop 1 -i img -i audio \
  -tune stillimage -pix_fmt yuv420p \
  -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 \
  -c:v libx264 -c:a aac -shortest out.mp4
```

### Animated image (GIF / animated WebP)
1. `decode.ts` produces frames + per-frame durations.
2. Write `frame_000.png … frame_NNN.png` to the ffmpeg in-memory FS.
3. Build an ffmpeg **concat demuxer list** with each frame's real duration
   (preserves variable per-frame timing).
4. Repeat the list `ceil(audioDuration / animationDuration)` times so the loop
   fills the audio length.
5. Encode to H.264 + AAC, even dimensions, `-shortest` against the audio.

## Error handling

- Wrong file type at a drop zone → reject immediately with a message; keep prior
  valid file.
- ffmpeg core fails to load → clear error message, Generate stays disabled.
- Encode throws → show the tail of ffmpeg's stderr; keep both files so the user
  can retry.
- Firefox / unsupported `ImageDecoder` on an animated file → surface a clear
  message pointing at the browser-support note (no silent static fallback).

## Testing

- **Unit (pure functions):**
  - encode argument-list builder: static vs animated input → correct arg array.
  - concat-list builder: frames + durations → correct list text.
  - loop-count math: `ceil(audioDuration / animationDuration)`.
- **Manual e2e:** real photo+mp3, real GIF+mp3, real animated-WebP+mp3 in Chrome
  → confirm playable MP4 of correct duration.

## Out of scope (YAGNI)

- Server-side encoding, accounts, storage.
- User-set duration, trimming, multiple images, transitions.
- Output format/resolution toggles.
- Firefox animated-image support.
