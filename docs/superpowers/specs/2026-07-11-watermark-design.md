# Watermark on generated video — design

Date: 2026-07-11

## Goal

Overlay a text watermark (default `https://late-night-vibes.com`) on the exported
MP4. Size and location are user-adjustable, WYSIWYG: the preview shows exactly
what the export bakes in.

## Approach (chosen)

Reuse the visualizer's proven pattern:

- **Shared draw code** (`wm-draw.ts`): canvas text rendering used by both the
  live preview and the export. Same browser font → preview and export match.
- **Preview** (`preview-wm.ts`): transparent absolutely-positioned canvas over
  the image, drag to move, bottom-right handle to resize (font size). Outline +
  handle are preview-only editing aids.
- **Export**: watermark rendered once to a single transparent PNG at image
  resolution, overlaid via a second ffmpeg `overlay` filter chained after the
  visualizer overlay (or directly on the base when no viz).

Rejected alternatives:

- ffmpeg `drawtext`: the @ffmpeg/core wasm build ships no fonts; loading a font
  file adds weight and the preview font wouldn't match.
- Baking the watermark into the viz frames: watermark must work with viz "none".

## Data model

- `WmLayout = { x, y, size }` — normalized to image dims; `x,y` anchor the text
  top-left, `size` is font height as a fraction of image height.
  Default: `{ x: 0.03, y: 0.92, size: 0.045 }` (bottom-left).
- `WmArgs = { x, y, durationSec }` — integer overlay pixels plus the audio
  duration, used as a `-t` cap for the watermark-only static path (the `-loop 1`
  base input is infinite).
- UI: text input prefilled with the URL; empty text disables the watermark.

## ffmpeg filtergraph

```
[0:v]scale[bg];[bg][1:v]overlay(viz):shortest=1[v1];[v1][2:v]overlay(wm)[vout]
```

A single still-PNG overlay input persists for the whole video via ffmpeg's
default `eof_action=repeat`. Audio stream index shifts with the optional inputs.

## Testing

Unit tests on `buildStaticArgs` / `buildAnimatedArgs` for: watermark-only,
viz+watermark chaining, audio map index shift, `-t` cap presence/absence.
Existing no-viz and viz-only argument shapes stay byte-identical.
