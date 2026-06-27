# Visualizer reposition + resize — Design

**Date:** 2026-06-26
**Status:** Approved, ready for implementation plan

## Purpose

Let the user position and size the music visualizer freely instead of it being
locked to a bottom, full-width, quarter-height strip. The same layout drives
both the live preview and the exported MP4.

Stays vanilla TS + Vite + ffmpeg.wasm. No new dependencies.

## Shared model

```ts
export type VizLayout = { x: number; y: number; w: number; h: number };
export const DEFAULT_VIZ_LAYOUT: VizLayout = { x: 0, y: 0.75, w: 1, h: 0.25 };
```

All four values are fractions of the image: `x`/`y` are the box's top-left
corner; `w`/`h` are its width/height. The default reproduces today's
bottom/full-width/quarter look exactly, so existing behaviour is unchanged until
the user moves a slider.

Clamping: `w` and `h` are clamped to a minimum of `0.01` (a zero-size box makes
ffmpeg error and the canvas vanish). `x`/`y` clamp to `0..1`. A box that extends
past the right/bottom edge simply clips — no special handling.

## Export mapping (`encode-args.ts`)

`buildVizComplex(style, layout)` generalizes the fixed coordinates. The
filtergraph shape (asplit → filter → scale2ref → overlay) is unchanged; only the
`scale2ref` size and `overlay` position become parameterized:

```
[viz0][bg]scale2ref=w=main_w*{w}:h=main_h*{h}[viz][bg2];
[bg2][viz]overlay=x=W*{x}:y=H*{y}[vout]
```

(`main_w`/`main_h` are the reference/`[bg]` dimensions; `W`/`H` are the overlay
base dimensions.) Validated against native ffmpeg for default, corner, top-left,
and mid-frame boxes — all render valid MP4s.

`buildStaticArgs` and `buildAnimatedArgs` gain a `layout: VizLayout` parameter
(after the existing `style` parameter). When `style === "none"` they emit
today's exact args (layout ignored). The numbers are formatted with a small
helper so the strings are deterministic (e.g. `0.25`, `1`, `0`).

`EncodeInput` (`StaticInput` + `AnimatedInput`) gains `vizLayout: VizLayout`.

## Preview mapping (`preview-viz.ts`)

The preview canvas is positioned per the same layout. `createPreviewViz` gains:

```ts
setLayout(layout: VizLayout): void;
```

It sets the canvas's inline style: `left: x*100%`, `top: y*100%`,
`width: w*100%`, `height: h*100%`. The existing `draw()` already reads
`canvas.clientWidth/Height` each frame, so it adapts to the new size on the next
frame while playing. `attach()` re-applies the current layout to a freshly
created canvas.

`#imageHost { overflow: hidden }` clips the canvas to the image box, matching the
export's edge clipping. The previous fixed `#vizCanvas` CSS size (`bottom:0;
width:100%; height:30%`) is removed — position/size now come from `setLayout`.
This also resolves the prior 30%-preview vs 25%-export drift: both are now driven
by `DEFAULT_VIZ_LAYOUT.h = 0.25`.

## UI (`main.ts`)

Four range sliders (`x`, `y`, `width`, `height`), each `min=0 max=100` (width/
height effectively floored at 1), with a live percent label. Initial values from
`DEFAULT_VIZ_LAYOUT` (0 / 75 / 100 / 25).

- A module-level `vizLayout` holds the current fractions.
- On any slider `input`: recompute `vizLayout` (clamp `w`/`h` ≥ 0.01), update the
  label, and call `previewViz.setLayout(vizLayout)` for a live preview update.
- In `refresh()` after `renderPreview`: `previewViz.attach(canvas)` then
  `previewViz.setLayout(vizLayout)`.
- At generate: pass `vizLayout` into `buildInput`, which stamps it onto the
  `EncodeInput` as `vizLayout`.

The sliders stay visible regardless of style (harmless when `none`).

## Files touched

- `src/encode-args.ts` — `VizLayout`, `DEFAULT_VIZ_LAYOUT`, parameterized
  `buildVizComplex`, layout params on the two arg builders, a number formatter.
- `src/encode-args.test.ts` — layout assertions (default + custom).
- `src/encode.ts` — `vizLayout` on both input types; pass through.
- `src/preview-viz.ts` — `setLayout`; apply on `attach`.
- `src/preview.ts` — (canvas creation unchanged; sizing now via JS — verify it
  still appends `#vizCanvas`).
- `src/main.ts` — four sliders + labels; `vizLayout` state; wiring.
- `src/style.css` — `#imageHost { overflow: hidden }`; `#vizCanvas` base rule
  (position/pointer-events only); slider row styling.

## Testing

- `buildVizComplex`: unit tests (TDD) assert the `scale2ref`/`overlay`
  substrings for `DEFAULT_VIZ_LAYOUT` and for a custom layout
  (e.g. `{x:0.1,y:0.2,w:0.5,h:0.25}` → `scale2ref=w=main_w*0.5:h=main_h*0.25`,
  `overlay=x=W*0.1:y=H*0.2`). Verify the `none` path is unchanged.
- Preview repositioning: manual browser smoke (move each slider, confirm the
  overlay box moves/resizes live; export coords re-validated natively).

## Out of scope (YAGNI)

- Drag handles / interactive resize.
- Rotation, opacity, per-style layouts, position presets.
- Aspect-ratio locking.
