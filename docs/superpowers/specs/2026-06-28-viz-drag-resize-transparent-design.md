# Visualizer drag/resize + transparent background — Design

**Date:** 2026-06-28
**Status:** Approved, ready for implementation plan

## Purpose

Two changes to the visualizer:

1. **Direct manipulation** — replace the four x/y/w/h sliders with dragging the
   visualizer box on the preview to move it, and a bottom-right corner handle to
   resize it.
2. **Transparent background** — remove the dark band behind the visualizer so
   the bars/waveform overlay the image directly, in both the export and the
   preview.

The `VizLayout = {x,y,w,h}` model and `DEFAULT_VIZ_LAYOUT` are unchanged — only
the input method and the background rendering change.

## Part 1 — Transparent background

### Export (`encode-args.ts`)

`showfreqs`/`showwaves` render the bars/line on an opaque black background; the
overlay of that box is the "band". To drop it, key the black out to transparency
before overlay. `buildVizComplex` appends a shared suffix to the chosen filter:

```
[avis]<VIZ_FILTERS[style]>,format=rgba,colorkey=0x000000:0.30:0.10[viz0]
```

`colorkey=0x000000:0.30:0.10` makes near-black pixels transparent; the gray
bars/line (`colors=gray`, far from black) survive. `overlay` already honors the
resulting alpha. Validated against native ffmpeg for both styles — the frame
shows gray bars over the image with no black band.

`VIZ_FILTERS` keeps its current per-style strings (`showfreqs=mode=bar:ascale=log:colors=gray`,
`showwaves=mode=line:colors=gray`); the transparency suffix is added once in
`buildVizComplex` so it stays DRY.

### Preview (`preview-viz.ts`)

Stop filling the dark band rectangle. The canvas is transparent; only the
bars/line draw (gray). Because the box would then be invisible when paused or
empty — which breaks positioning — draw a **subtle 1px outline** as an editing
guide instead of a filled band:

- Outline: `strokeStyle rgba(255,255,255,0.35)`, `strokeRect(0.5, 0.5, w-1, h-1)`.
- This outline is a **preview-only editing aid**; it is never baked into the
  export (the export is genuinely transparent).

So the render order becomes: clear → (style none? stop) → outline → handle →
(not playing? stop) → bars/line.

## Part 2 — Drag to move, corner to resize

All interaction lives in `preview-viz.ts`, which owns the canvas.

### Canvas interactivity

- `pointer-events: auto` when a style is active, `none` when `style === "none"`
  (so clicks pass through to the image otherwise). Set in `applyLayout`/`setStyle`.
- `touch-action: none` so touch-dragging doesn't scroll the page.

### Pointer handling

Listeners are bound to the canvas in `attach` (the canvas is recreated per
preview render, so re-bind each time).

- **pointerdown:** hit-test the pointer (canvas-relative `offsetX/offsetY`). If
  within the bottom-right `HANDLE` px (≈16) → `mode = "resize"`, else
  `mode = "move"`. Snapshot the start pointer (`clientX/Y`) and a copy of the
  current layout. `canvas.setPointerCapture(e.pointerId)`.
- **pointermove (dragging):** compute deltas as fractions of the
  `#imageHost` box (`canvas.parentElement.getBoundingClientRect()`):
  - `move`: `x = clamp(start.x + dxFrac, 0, 1)`, `y = clamp(start.y + dyFrac, 0, 1)`.
  - `resize`: `w = clamp(start.w + dxFrac, 0.05, 1)`, `h = clamp(start.h + dyFrac, 0.05, 1)` (top-left anchored).
  - Update `layout`, `applyLayout`, redraw (band/outline follows live, even
    paused), and fire `onLayoutChange(layout)`.
- **pointermove (not dragging):** set `canvas.style.cursor` to `nwse-resize` over
  the handle, else `move` — so the corner is discoverable.
- **pointerup:** `releasePointerCapture`, `mode = null`.

### Affordance

`render()` draws a small light handle square (`~12px`,
`rgba(255,255,255,0.9)`) at the bottom-right corner, in both paused and playing
states (drawn before the live/return check so it always shows).

### API change

`createPreviewViz(audioEl, onLayoutChange: (layout: VizLayout) => void)`. The new
second parameter lets the drag interaction report layout changes back so the
export value stays in sync.

## main.ts

- Remove the four sliders, their value spans, queries, `updateVizLayout`, and the
  `input` listeners.
- Replace the slider block with a one-line hint:
  `Drag the visualizer to move it · drag the corner to resize.`
- Create `const previewViz = createPreviewViz(audioEl, (l) => { vizLayout = l; });`
- `vizLayout` state, `buildInput(..., vizLayout)`, and `refresh()`
  (`attach` → `setStyle` → `setLayout(vizLayout)`) are otherwise unchanged.

## style.css

- Remove the `.sliders` / `.slider` rules (no longer used).
- `#vizCanvas`: add `touch-action: none`. Cursor is set inline by JS; keep
  `position: absolute`. (`pointer-events` is now controlled inline by JS.)

## Files touched

- `src/encode-args.ts` — colorkey suffix in `buildVizComplex`.
- `src/encode-args.test.ts` — assert the colorkey suffix is present.
- `src/preview-viz.ts` — transparent render (outline+handle, no band fill),
  pointer drag/resize, `onLayoutChange` param.
- `src/main.ts` — remove sliders, add hint, pass callback.
- `src/style.css` — drop slider rules, `touch-action` on canvas.

## Testing

- `buildVizComplex`: unit test asserts the emitted filter contains
  `colorkey=0x000000:0.30:0.10` (and still the per-style filter + scale2ref/
  overlay substrings). Default-layout / custom-layout tests stay.
- Drag/resize + transparency are pointer/canvas behavior → Playwright browser
  smoke: simulate a drag on the box (layout x/y change), a drag on the corner
  (w/h change with clamping), confirm no dark band fill (canvas transparent
  except bars/outline/handle), and that `none` makes the canvas non-interactive.
  Export transparency re-validated natively (done).

## Out of scope (YAGNI)

- Handles other than bottom-right; rotation; keyboard nudge; snapping/guides.
- Configurable outline/handle styling or colorkey tolerance.
