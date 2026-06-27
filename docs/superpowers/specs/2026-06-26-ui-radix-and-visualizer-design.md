# UI refresh (Radix look) + music visualizer — Design

**Date:** 2026-06-26
**Status:** Draft, awaiting approval

## Purpose

Two changes to the existing gifsync app:

1. **Better-looking UI** using the Radix aesthetic — without adding React.
2. **A music visualizer baked into the exported MP4**, with a dropdown to pick
   the style (off / bars / waveform / spectrum).

The app stays vanilla TS + Vite + ffmpeg.wasm. No framework migration.

## Part 1 — UI refresh (Radix look, no React)

### Decision

Radix UI's components are React-only. This app has **no complex widgets**
(no modals, menus, tabs, tooltips) where Radix primitives earn their keep —
the only interactive control we're adding is a `<select>`. So we adopt Radix's
**visual** system, not its components:

- Add **`@radix-ui/colors`** (CSS-only dependency — color scale variables, no JS,
  no React).
- Rewrite `style.css` using Radix Colors tokens: a gray scale (`slate`) for
  surfaces/text/borders and an accent scale (`indigo`) for the primary button,
  focus rings, and "filled" drop-zone state. Keep `red` for errors.
- Visual polish: a centered card/panel surface, consistent radii, subtle
  border + shadow, proper focus-visible rings, hover/active states on the
  button and drop zones, tidy spacing scale.

### Dark mode

Radix ships separate light and dark color CSS (dark scoped to a `.dark` class).
Preserve today's automatic light/dark behaviour with a 2-line `matchMedia`
listener that toggles `.dark` on `<html>`. No theme toggle UI (YAGNI).

### Markup changes

Minimal. Keep the existing `#app` structure; wrap it in a panel element, and
add the visualizer `<select>` (see Part 2). No new components, no build changes.

### New dependency

- `@radix-ui/colors` — CSS variables only, bundled by Vite (not a CDN fetch),
  so no impact on the existing COOP/COEP setup.

## Part 2 — Music visualizer baked into the MP4

### Decision: do it in ffmpeg, not Web Audio

ffmpeg.wasm has built-in audio-reactive video filters. We feed the audio into
one of them, overlay the result on the image, and ffmpeg bakes the visualizer
into the output. **No Web Audio / canvas / per-frame compositing code** — the
change is entirely in the `filter_complex` string built by `encode-args.ts`.

### Styles (dropdown)

A `<select id="vizStyle">` with four options:

| Value      | ffmpeg filter        | Look                          |
|------------|----------------------|-------------------------------|
| `none`     | — (current behaviour)| No visualizer                 |
| `bars`     | `showfreqs=mode=bar` | EQ frequency bars             |
| `waveform` | `showwaves=mode=line`| Scrolling waveform line       |
| `spectrum` | `showspectrum`       | Colorful frequency band       |

Default: `none` (opt-in, so existing behaviour is unchanged unless chosen).

> `showspectrum` is chosen over `showcqt` for the "spectrum" style because
> `showcqt`'s note axis needs fontconfig, which may be absent from the wasm
> core. `showspectrum` has no font dependency.

### Filtergraph shape

For each non-`none` style, replace the simple `-vf scale=...` with a
`-filter_complex` that:

1. `asplit`s the audio into two — one copy drives the visualizer, one is muxed
   to the output (so the song still plays).
2. Runs the chosen audio→video filter on copy 1.
3. Even-scales the base image/animation to `[bg]`.
4. Scales the visualizer to the base's width and ~1/4 its height
   (`scale2ref`), and `overlay`s it as a bottom strip.
5. Maps the composited video `[vout]` and the second audio copy to the output.

Both code paths (`buildStaticArgs`, `buildAnimatedArgs`) gain a `style`
parameter. When `style === "none"`, they emit today's exact args (current tests
stay green unchanged).

The **exact** filter strings (`scale2ref` expression order, overlay coords,
showfreqs/showwaves options) are fiddly and version-sensitive, so they're
**validated by a spike test against the real ffmpeg.wasm** during
implementation — not guessed in the doc. Unit tests assert the arg *structure*
(filter present, asplit present, correct maps); a manual smoke render confirms
a real MP4 comes out with the bars/waveform/spectrum visible.

### What the in-app preview shows

The live preview keeps showing the still/animated image + audio player as today.
It does **not** render a live visualizer — that would need separate Web Audio
+ canvas code and still wouldn't match ffmpeg's output exactly. A short caption
tells the user the visualizer appears in the exported video.
*(Deferred, not skipped — can add a canvas preview later if wanted.)*

### Risk / fallback

If the bundled ffmpeg core turns out to be missing a filter, the spike catches
it immediately. Fallback per style: `showfreqs`→`showspectrum`, `showwaves` is
core and low-risk, `showspectrum`→`showwaves`. Worst case, drop the offending
option from the dropdown. We confirm availability in the spike before wiring UI.

## Files touched

- `package.json` — add `@radix-ui/colors`.
- `src/style.css` — full restyle with Radix tokens.
- `src/main.ts` — panel wrapper markup, `vizStyle` select + state, pass style
  into encode; tiny dark-mode `matchMedia` toggle.
- `src/encode-args.ts` — `style` param + `filter_complex` builder.
- `src/encode.ts` — thread `style` through to the arg builders.
- `src/encode-args.test.ts` — extend for the new arg shapes.

## Out of scope (YAGNI)

- React / Radix Primitives / Radix Themes.
- Live in-browser visualizer preview.
- Visualizer customization (colors, height, position) — fixed sensible defaults.
- Theme toggle UI.
