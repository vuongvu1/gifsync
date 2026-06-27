# Visualizer live preview + simpler neutral styles — Design

**Date:** 2026-06-26
**Status:** Approved, ready for implementation plan

## Purpose

Two refinements to the just-shipped visualizer feature:

1. **Simpler + neutral** — drop the colorful `spectrum` style; keep `none` / `bars` / `waveform`, both rendered in a neutral gray.
2. **Live preview** — show an animated approximation of the chosen visualizer in the in-app preview, synced to audio playback, so the user sees the style before exporting.

Stays vanilla TS + Vite + ffmpeg.wasm. No new dependencies.

## Part 1 — Simpler neutral styles

- `VizStyle` becomes `"none" | "bars" | "waveform"` (remove `"spectrum"`).
- `VIZ_FILTERS`:
  - `bars`: `showfreqs=mode=bar:ascale=log:colors=gray`
  - `waveform`: `showwaves=mode=line:colors=gray`
- Remove the `spectrum` `<option>` from the dropdown and from the `VIZ_STYLES`
  runtime guard list in main.ts.
- Update `encode-args.test.ts`: drop the spectrum assertion; the bars/waveform
  structure tests stay (filter substrings still present).
- Re-validate the two gray filtergraphs against native ffmpeg before wiring.

The `buildVizComplex` filtergraph shape (asplit → filter → scale2ref → overlay)
is unchanged — only the per-style filter strings change.

## Part 2 — Live preview (`preview-viz.ts`)

A new module owns a Web Audio + canvas visualizer that overlays the preview
image.

### Audio graph

- Lazily create one `AudioContext`, one `MediaElementSource(audioEl)`, and one
  `AnalyserNode`, wired `source → analyser → ctx.destination` so the song still
  plays through the speakers.
- `MediaElementSource` is one-per-element and is created **once** (it persists
  across `audioEl.src` swaps).
- Creation is deferred until the first `play` event — an `AudioContext` cannot
  start without a user gesture; pressing play is that gesture. Resume the
  context on play.

### Render loop

- `requestAnimationFrame` loop runs only while the audio is playing.
- `bars`: `analyser.getByteFrequencyData` → N vertical bars from the bottom.
- `waveform`: `analyser.getByteTimeDomainData` → a single horizontal line.
- Neutral palette, readable over any image and mirroring the export's band:
  a translucent dark band (`rgba(0,0,0,0.45)`) filling the canvas, then bars /
  line in light gray (`rgba(255,255,255,0.85)`).
- On `pause` / `ended`, stop the loop and clear the canvas.
- `style === "none"` → clear and draw nothing.

### Module API

```ts
export function createPreviewViz(audioEl: HTMLAudioElement): {
  attach(canvas: HTMLCanvasElement): void; // point the loop at a (possibly new) canvas
  setStyle(style: VizStyle): void;         // change the active style; clears if none/paused
};
```

`attach` is called whenever `renderPreview` rebuilds the preview (the canvas is
recreated with the image). `setStyle` is called on dropdown change.

### Layout (preview.ts + style.css)

- `renderPreview` appends a fresh `<canvas id="vizCanvas">` into `#imageHost`
  alongside the `<img>`, and sets the img to `width:100%; display:block` so the
  overlay aligns to the image box.
- CSS: `#imageHost { position: relative; }`,
  `#vizCanvas { position:absolute; left:0; bottom:0; width:100%; height:30%; pointer-events:none; }`.
- Canvas backing resolution is set from its client size at draw time.

### main.ts wiring

- Create `const previewViz = createPreviewViz(audioEl)` once.
- In `refresh()` after `renderPreview`, query the new `#vizCanvas`, call
  `previewViz.attach(canvas)` and `previewViz.setStyle(readVizStyle(vizSelect.value))`.
- Add a `vizSelect` `change` listener → `previewViz.setStyle(...)`.

## Fidelity note

The preview is an approximation: its FFT size and smoothing differ from
ffmpeg's `showfreqs`/`showwaves`, so motion won't be byte-identical to the
exported MP4. It conveys the style and neutral color, which is the point.

## Files touched

- `src/encode-args.ts` — drop spectrum, gray colors.
- `src/encode-args.test.ts` — drop spectrum test.
- `src/preview-viz.ts` — **new**, Web Audio + canvas visualizer.
- `src/preview.ts` — add canvas overlay to `renderPreview`.
- `src/main.ts` — drop spectrum option/guard; wire `previewViz`.
- `src/style.css` — `#imageHost` relative + `#vizCanvas` overlay + img sizing.

## Testing

- `encode-args` change: unit tests (TDD), update spectrum-related test.
- `preview-viz.ts`: Web Audio + canvas don't run under jsdom → manual browser
  smoke (drop image+audio, pick bars then waveform, press play, confirm the
  overlay animates in neutral gray and the console is clean; pause clears it).

## Out of scope (YAGNI)

- Byte-exact preview (would require running ffmpeg per preview).
- Preview while paused / scrubbing without playback.
- Configurable preview height, bar count, colors.
