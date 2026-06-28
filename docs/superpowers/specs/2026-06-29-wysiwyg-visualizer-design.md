# WYSIWYG visualizer (single renderer) — Design

**Date:** 2026-06-29
**Status:** Draft, awaiting spec review

## Purpose

The preview visualizer and the exported visualizer currently look different
because they use two different renderers: the preview draws on a canvas; the
export uses ffmpeg's `showfreqs`/`showwaves`. Make them identical by rendering
the export's visualizer frames in-browser with the **same draw code** as the
preview, then overlaying those frames in ffmpeg.

Also: make **Frequency bars** the default style (instead of None).

Stays vanilla TS + Vite + ffmpeg.wasm. No new dependencies.

## Root cause (confirmed)

Preview = custom canvas (48 chunky gapped gray bars, analyser-driven). Export =
ffmpeg `showfreqs` (hundreds of thin per-bin spikes, log-scaled). Only box
position/size/color/transparency were ever aligned — never the bar shape. ffmpeg
filters can't reproduce the canvas look. The only fix is one renderer.

## Architecture

One renderer, used for both preview and export.

### New module: `src/fft.ts`

A small, pure, radix-2 iterative FFT (size 512). Pure function → unit-tested.

```ts
// In-place complex FFT; re/im length must be a power of two.
export function fft(re: Float32Array, im: Float32Array): void;
```

### New module: `src/viz-draw.ts`

The bar/line drawing extracted verbatim from `preview-viz.ts` so preview and
export share it exactly:

```ts
export function drawBars(ctx: CanvasRenderingContext2D, w: number, h: number, freq: Uint8Array): void;
export function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, time: Uint8Array): void;
```

- `drawBars`: 48 bars, `step = floor(freq.length/48)`, `bw = w/48`,
  `bh = (freq[i*step]/255)*h`, `fillRect(i*bw, h-bh, bw*0.7, bh)`, gray.
- `drawWave`: line across `time.length` points, `x = i/(len-1)*w`,
  `y = (time[i]/255)*h`, gray.
- Both assume the caller set fill/stroke style and a transparent/cleared canvas.

`preview-viz.ts` imports these (its `render()` computes `freq`/`time` from the
live `AnalyserNode`, calls the shared fn, then adds its preview-only outline +
handle).

### New module: `src/viz-frames.ts`

Generates the export's visualizer PNG frames offline, deterministically.

```ts
export async function renderVizFrames(
  audio: Blob,
  style: "bars" | "waveform",
  boxW: number,   // px
  boxH: number,   // px
  fps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]>;  // PNG bytes per frame, covering the audio duration
```

Steps:
1. `decodeAudioData` (via an `AudioContext`/`OfflineAudioContext`) → mono PCM
   (average channels) + `sampleRate` + `duration`.
2. `totalFrames = max(1, ceil(duration * fps))`.
3. For each frame `i`: window = `samples[floor(i/fps * sampleRate) .. +512]`
   (zero-padded at the end).
   - **bars** → Blackman-window the 512 samples, `fft`, magnitude per bin
     `k=0..255` normalized by `fftSize`, frame-to-frame smoothing `0.8`, dB
     `20*log10(mag)` mapped from `[-100,-30]` to a `Uint8Array(256)` byte
     (mirrors `AnalyserNode.getByteFrequencyData`).
   - **waveform** → `Uint8Array(512)` time bytes `clamp(round(128 + s*128),0,255)`
     (mirrors `getByteTimeDomainData`).
4. Draw with `drawBars`/`drawWave` onto a reused offscreen canvas sized
   `boxW × boxH` (cleared each frame, transparent), then `canvas` → PNG bytes.

This matches the preview's look (same draw code + comparable analyser math);
it is not bit-identical to the live analyser's playback-timing smoothing, which
is meaningless to match.

### Export wiring

- `EncodeInput` (`StaticInput` + `AnimatedInput`): replace `visualizer`/
  `vizLayout` carriage with `viz: { frames: Uint8Array[]; x: number; y: number; fps: number } | null` (null = no visualizer).
- `encode.ts`: when `input.viz`, write each frame as `viz_00000.png`… (5-digit,
  `padStart(5,"0")`), then build args with the overlay; clean them up afterward
  alongside the existing FS cleanup.
- `encode-args.ts`: **remove** `VIZ_FILTERS` and `buildVizComplex` (showfreqs/
  colorkey/scale2ref all gone). The builders gain an optional `viz` param:

```ts
type VizArgs = { x: number; y: number; fps: number }; // px overlay coords + frame rate
buildStaticArgs(imageName, audioName, out, viz?: VizArgs): string[]
buildAnimatedArgs(audioName, out, viz?: VizArgs): string[]
```

  With `viz`, inputs are `[0]` image/concat, `[1]` `-framerate {fps} -i viz_%05d.png`,
  `[2]` audio, and filter
  `[0:v]<EVEN_SCALE>[bg];[bg][1:v]overlay=x={x}:y={y}:shortest=1[vout]`,
  mapping `[vout]` + `2:a`. Without `viz` → today's exact `none` args.
  `VizStyle`, `VizLayout`, `DEFAULT_VIZ_LAYOUT` stay (used by preview + main).

### main.ts wiring

- Default style: the `<option value="bars">` gets `selected`; `vizLayout`
  default unchanged. Preview shows bars once an image + audio are loaded.
- On generate, when style ≠ none:
  1. Output dims via `createImageBitmap` on the image (or first animated frame),
     even-floored (`d - d%2`) to match ffmpeg's `trunc(iw/2)*2`.
  2. `boxW = max(1, round(layout.w*evenW))`, `boxH = max(1, round(layout.h*evenH))`;
     overlay `x = round(layout.x*evenW)`, `y = round(layout.y*evenH)`.
  3. Status "Rendering visualizer…" (with frame progress), then
     `frames = await renderVizFrames(audio, style, boxW, boxH, 15, …)`.
  4. Pass `viz = { frames, x, y, fps: 15 }` into the encode input; `none` → `viz: null`.

## Files

- New: `src/fft.ts` (+ `src/fft.test.ts`), `src/viz-draw.ts`, `src/viz-frames.ts`.
- Modified: `src/preview-viz.ts` (use `viz-draw`), `src/encode-args.ts`
  (+test: overlay args, drop showfreqs), `src/encode.ts` (write frames + new
  args), `src/main.ts` (default bars, dims + `renderVizFrames` + status).

## Testing

- `fft.ts`: unit tests — known signals (DC, single sine bin) produce expected
  spectra; round-trip/linearity sanity.
- `encode-args.ts`: unit tests — `buildStaticArgs`/`buildAnimatedArgs` with `viz`
  emit `-framerate 15`, `viz_%05d.png`, `overlay=x=…:y=…:shortest=1`, correct
  maps; `none` path unchanged.
- `viz-draw.ts` / `viz-frames.ts` / preview: browser smoke (Playwright) — bars
  default renders; a rendered export frame visually matches the preview's bars;
  export overlay-sequence re-validated against native ffmpeg.

## Performance

15 fps, box-sized PNGs, sequential frame gen with progress. Long audio → slower
export (status communicates it). Frames are cleaned from the wasm FS after encode.

## Out of scope (YAGNI)

- Changing the bar/line visual design itself.
- Configurable fps in the UI.
- Bit-exact match to the live analyser's playback smoothing.
- Caching rendered frames between generations.
