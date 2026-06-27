# Visualizer Reposition + Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user freely position and size the visualizer via four x/y/w/h sliders, with the same layout driving both the live preview and the exported MP4.

**Architecture:** A shared `VizLayout = {x,y,w,h}` (fractions of the image) parameterizes the ffmpeg `scale2ref`/`overlay` coordinates in `encode-args.ts` and the preview canvas's inline CSS in `preview-viz.ts`. `DEFAULT_VIZ_LAYOUT` reproduces today's bottom/full-width/quarter strip so nothing changes until a slider moves.

**Tech Stack:** TypeScript, Vite, ffmpeg.wasm, Canvas/DOM, Vitest. No new dependencies.

## Global Constraints

- No new dependencies. No React.
- `VizLayout = { x: number; y: number; w: number; h: number }`, fractions 0..1: `x`/`y` = box top-left corner, `w`/`h` = size.
- `DEFAULT_VIZ_LAYOUT = { x: 0, y: 0.75, w: 1, h: 0.25 }` — must reproduce the current export/preview exactly.
- `w`/`h` clamped to a minimum of `0.01` (zero-size box → ffmpeg error / vanished canvas). `x`/`y` in `0..1`. Out-of-bounds box just clips.
- Export coords (validated against native ffmpeg): `scale2ref=w=main_w*{w}:h=main_h*{h}` then `overlay=x=W*{x}:y=H*{y}`. Filtergraph shape (asplit→filter→scale2ref→overlay) otherwise unchanged.
- ffmpeg number strings must be deterministic — format via the `fmt` helper (Task 1).
- `style === "none"` path emits today's exact args (layout ignored).
- Toolchain: pnpm; Node 18+ (`node -v`; if < 18 `nvm use`). Tests: `pnpm test`. Build: `pnpm build`.

---

### Task 1: Parameterize the export filtergraph by layout

Add `VizLayout`, `DEFAULT_VIZ_LAYOUT`, a number formatter, and thread an optional `layout` through `buildVizComplex` and the two arg builders. Pure functions — full TDD. Optional params (defaulting to `DEFAULT_VIZ_LAYOUT`) keep existing call sites compiling, so this task builds green on its own.

**Files:**
- Modify: `src/encode-args.ts`
- Test: `src/encode-args.test.ts`

**Interfaces:**
- Produces:
  - `type VizLayout = { x: number; y: number; w: number; h: number }`
  - `const DEFAULT_VIZ_LAYOUT: VizLayout`
  - `buildVizComplex(style: Exclude<VizStyle,"none">, layout?: VizLayout): string`
  - `buildStaticArgs(imageName, audioName, out, style?: VizStyle, layout?: VizLayout): string[]`
  - `buildAnimatedArgs(audioName, out, style?: VizStyle, layout?: VizLayout): string[]`

- [ ] **Step 1: Update/extend the tests**

In `src/encode-args.test.ts`, replace the `buildVizComplex` describe block with these (note `DEFAULT_VIZ_LAYOUT` produces `w=main_w*1:h=main_h*0.25` and `overlay=x=W*0:y=H*0.75`):

```typescript
describe("buildVizComplex", () => {
  it("uses the default layout (bottom, full width, quarter height)", () => {
    const c = buildVizComplex("bars");
    expect(c).toContain("[1:a]asplit=2[aud][avis]");
    expect(c).toContain("showfreqs=mode=bar:ascale=log:colors=gray");
    expect(c).toContain("scale2ref=w=main_w*1:h=main_h*0.25[viz][bg2]");
    expect(c).toContain("overlay=x=W*0:y=H*0.75[vout]");
  });
  it("maps a custom layout into scale2ref size and overlay position", () => {
    const c = buildVizComplex("waveform", { x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
    expect(c).toContain("showwaves=mode=line:colors=gray");
    expect(c).toContain("scale2ref=w=main_w*0.5:h=main_h*0.25[viz][bg2]");
    expect(c).toContain("overlay=x=W*0.1:y=H*0.2[vout]");
  });
});
```

Add a `DEFAULT_VIZ_LAYOUT` import to the existing import block at the top of the test file:

```typescript
import {
  DEFAULT_VIZ_LAYOUT,
  buildAnimatedArgs,
  buildConcatList,
  buildStaticArgs,
  buildVizComplex,
  computeRepeatCount,
} from "./encode-args";
```

And add one test confirming the default constant value:

```typescript
describe("DEFAULT_VIZ_LAYOUT", () => {
  it("is the bottom full-width quarter strip", () => {
    expect(DEFAULT_VIZ_LAYOUT).toEqual({ x: 0, y: 0.75, w: 1, h: 0.25 });
  });
});
```

(The existing `buildStaticArgs`/`buildAnimatedArgs` viz tests call `buildVizComplex("bars")`/`("waveform")` with no layout and still pass — they use the default.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- encode-args`
Expected: FAIL — `DEFAULT_VIZ_LAYOUT` is not exported; the new `scale2ref=...*1`/`overlay=...` substrings don't match the current hardcoded `scale2ref=w=main_w:h=main_h/4` / `overlay=x=(W-w)/2:y=H-h`.

- [ ] **Step 3: Implement in `encode-args.ts`**

Add the type, default, and formatter near the top (after `EVEN_SCALE`), and rewrite `buildVizComplex` + the two builders' viz branches to use the layout. Keep `VizStyle`, `VIZ_FILTERS`, `computeRepeatCount`, `buildConcatList`, and the `"none"` branches exactly as they are.

```typescript
export type VizLayout = { x: number; y: number; w: number; h: number };

// Bottom strip, full width, quarter height — reproduces the original fixed overlay.
export const DEFAULT_VIZ_LAYOUT: VizLayout = { x: 0, y: 0.75, w: 1, h: 0.25 };

// Deterministic short decimal for ffmpeg expressions (avoids float noise like 0.30000000004).
function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

export function buildVizComplex(
  style: Exclude<VizStyle, "none">,
  layout: VizLayout = DEFAULT_VIZ_LAYOUT,
): string {
  const x = fmt(layout.x), y = fmt(layout.y), w = fmt(layout.w), h = fmt(layout.h);
  return [
    "[1:a]asplit=2[aud][avis]",
    `[avis]${VIZ_FILTERS[style]}[viz0]`,
    `[0:v]${EVEN_SCALE}[bg]`,
    `[viz0][bg]scale2ref=w=main_w*${w}:h=main_h*${h}[viz][bg2]`,
    `[bg2][viz]overlay=x=W*${x}:y=H*${y}[vout]`,
  ].join(";");
}
```

Update the two builders' signatures and their `buildVizComplex` calls. For `buildStaticArgs`:

```typescript
export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
  style: VizStyle = "none",
  layout: VizLayout = DEFAULT_VIZ_LAYOUT,
): string[] {
  if (style === "none") {
    return [
      "-loop", "1",
      "-i", imageName,
      "-i", audioName,
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-vf", EVEN_SCALE,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      out,
    ];
  }
  return [
    "-loop", "1",
    "-i", imageName,
    "-i", audioName,
    "-filter_complex", buildVizComplex(style, layout),
    "-map", "[vout]",
    "-map", "[aud]",
    "-tune", "stillimage",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  ];
}
```

For `buildAnimatedArgs`:

```typescript
export function buildAnimatedArgs(
  audioName: string,
  out: string,
  style: VizStyle = "none",
  layout: VizLayout = DEFAULT_VIZ_LAYOUT,
): string[] {
  if (style === "none") {
    return [
      "-f", "concat",
      "-safe", "0",
      "-i", "list.txt",
      "-i", audioName,
      "-pix_fmt", "yuv420p",
      "-vf", EVEN_SCALE,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      out,
    ];
  }
  return [
    "-f", "concat",
    "-safe", "0",
    "-i", "list.txt",
    "-i", audioName,
    "-filter_complex", buildVizComplex(style, layout),
    "-map", "[vout]",
    "-map", "[aud]",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- encode-args`
Expected: PASS — all tests green (default layout, custom layout, the constant, and the unchanged `none`/`-vf` tests).

- [ ] **Step 5: Verify build**

Run: `pnpm build`
Expected: PASS — existing `encode.ts` calls (`buildStaticArgs(..., input.visualizer)`) still compile because `layout` is optional.

- [ ] **Step 6: Commit**

```bash
git add src/encode-args.ts src/encode-args.test.ts
git commit -m "feat: parameterize visualizer overlay by x/y/w/h layout"
```

---

### Task 2: Layout sliders + preview wiring

Thread `vizLayout` through `EncodeInput` and `buildInput`, position the preview canvas via `setLayout`, add the four sliders, and the CSS. Build-verified + manual browser smoke.

**Files:**
- Modify: `src/encode.ts`
- Modify: `src/preview-viz.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Modify: `src/preview.ts` (verify only — see Step 5)

**Interfaces:**
- Consumes: `VizLayout`, `DEFAULT_VIZ_LAYOUT` from `./encode-args` (Task 1); `buildStaticArgs`/`buildAnimatedArgs` now accept a 5th `layout` arg.
- Produces:
  - `StaticInput`/`AnimatedInput` gain `vizLayout: VizLayout`.
  - `createPreviewViz(...)` return gains `setLayout(layout: VizLayout): void`.
  - `buildInput(image, audio, visualizer: VizStyle, vizLayout: VizLayout)` (main.ts).

- [ ] **Step 1: Add `vizLayout` to the encode inputs and pass it through (`encode.ts`)**

Update the import to also bring in `VizLayout`:

```typescript
import type { VizStyle, VizLayout } from "./encode-args";
```

Add `vizLayout: VizLayout;` to both `StaticInput` and `AnimatedInput` type definitions. Then update the two builder calls inside `encode()`:

```typescript
    args = buildStaticArgs(input.imageName, input.audioName, "out.mp4", input.visualizer, input.vizLayout);
```
```typescript
    args = buildAnimatedArgs(input.audioName, "out.mp4", input.visualizer, input.vizLayout);
```

- [ ] **Step 2: Add `setLayout` to `preview-viz.ts`**

Update the import and add a stored layout + an `applyLayout` that writes the canvas inline CSS, applied on both `attach` and `setLayout`:

```typescript
import { type VizStyle, type VizLayout, DEFAULT_VIZ_LAYOUT } from "./encode-args";
```

Inside `createPreviewViz`, add a `layout` variable next to the other state (`let style`, `let rafId`, etc.):

```typescript
  let layout: VizLayout = DEFAULT_VIZ_LAYOUT;
```

Add this helper (e.g. just below `clear`):

```typescript
  function applyLayout(): void {
    if (!canvas) return;
    canvas.style.left = `${layout.x * 100}%`;
    canvas.style.top = `${layout.y * 100}%`;
    canvas.style.width = `${layout.w * 100}%`;
    canvas.style.height = `${layout.h * 100}%`;
  }
```

Update `attach` to apply the layout, and add `setLayout` to the returned object:

```typescript
  return {
    attach(c: HTMLCanvasElement): void {
      canvas = c;
      applyLayout();
      if (audioEl.paused) clear();
    },
    setLayout(l: VizLayout): void {
      layout = l;
      applyLayout();
    },
    setStyle(s: VizStyle): void {
      style = s;
      if (s === "none" || audioEl.paused) clear();
    },
  };
```

Also update the function's return-type annotation to include the new method:

```typescript
export function createPreviewViz(audioEl: HTMLAudioElement): {
  attach(canvas: HTMLCanvasElement): void;
  setLayout(layout: VizLayout): void;
  setStyle(style: VizStyle): void;
} {
```

- [ ] **Step 3: Add the sliders + wiring in `main.ts`**

Update the imports:

```typescript
import { createPreviewViz } from "./preview-viz";
import { type VizStyle, type VizLayout, DEFAULT_VIZ_LAYOUT } from "./encode-args";
```

(If `VizStyle` is already imported on its own line, merge it into this one and remove the duplicate.)

Replace the `.controls` block in `app.innerHTML` with one that adds the slider rows:

```html
  <div class="controls">
    <label class="field">
      Visualizer
      <select id="vizStyle">
        <option value="none">None</option>
        <option value="bars">Frequency bars</option>
        <option value="waveform">Waveform</option>
      </select>
    </label>
    <div class="sliders">
      <label class="slider">X <input id="vizX" type="range" min="0" max="100" value="0" /><span id="vizXval">0%</span></label>
      <label class="slider">Y <input id="vizY" type="range" min="0" max="100" value="75" /><span id="vizYval">75%</span></label>
      <label class="slider">W <input id="vizW" type="range" min="1" max="100" value="100" /><span id="vizWval">100%</span></label>
      <label class="slider">H <input id="vizH" type="range" min="1" max="100" value="25" /><span id="vizHval">25%</span></label>
    </div>
    <p class="hint">Position &amp; size the visualizer. It's rendered into the exported video.</p>
  </div>
```

Add the element queries (near the other `app.querySelector` consts):

```typescript
const vizX = app.querySelector<HTMLInputElement>("#vizX")!;
const vizY = app.querySelector<HTMLInputElement>("#vizY")!;
const vizW = app.querySelector<HTMLInputElement>("#vizW")!;
const vizH = app.querySelector<HTMLInputElement>("#vizH")!;
const vizXval = app.querySelector<HTMLSpanElement>("#vizXval")!;
const vizYval = app.querySelector<HTMLSpanElement>("#vizYval")!;
const vizWval = app.querySelector<HTMLSpanElement>("#vizWval")!;
const vizHval = app.querySelector<HTMLSpanElement>("#vizHval")!;
```

Add the layout state next to the other `let` state (`imageFile`, etc.):

```typescript
let vizLayout: VizLayout = { ...DEFAULT_VIZ_LAYOUT };
```

Add the update function and listeners (place after the `previewViz` is created — see Step 4 for that line; this function calls `previewViz.setLayout`):

```typescript
function updateVizLayout(): void {
  vizLayout = {
    x: Number(vizX.value) / 100,
    y: Number(vizY.value) / 100,
    w: Math.max(0.01, Number(vizW.value) / 100),
    h: Math.max(0.01, Number(vizH.value) / 100),
  };
  vizXval.textContent = `${vizX.value}%`;
  vizYval.textContent = `${vizY.value}%`;
  vizWval.textContent = `${vizW.value}%`;
  vizHval.textContent = `${vizH.value}%`;
  previewViz.setLayout(vizLayout);
}
for (const el of [vizX, vizY, vizW, vizH]) {
  el.addEventListener("input", updateVizLayout);
}
```

Update `buildInput` to take and stamp the layout:

```typescript
async function buildInput(
  image: File,
  audio: File,
  visualizer: VizStyle,
  vizLayout: VizLayout,
): Promise<EncodeInput> {
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const audioName = `audio${ext(audio)}`;
  const animatedType = image.type === "image/gif" || image.type === "image/webp";
  if (animatedType) {
    const frames = await decodeAnimated(image);
    if (frames.length > 1) {
      const audioDurationSec = await getAudioDuration(audio);
      return { kind: "animated", frames, audio: audioBytes, audioName, audioDurationSec, visualizer, vizLayout };
    }
  }
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  return {
    kind: "static",
    image: imageBytes,
    imageName: `image${ext(image)}`,
    audio: audioBytes,
    audioName,
    visualizer,
    vizLayout,
  };
}
```

In the generate click handler, pass the layout:

```typescript
    const input = await buildInput(imageFile, audioFile, readVizStyle(vizSelect.value), vizLayout);
```

In `refresh()`, after attaching the canvas, push the current style AND layout:

```typescript
function refresh(): void {
  imageDrop.classList.toggle("filled", imageFile !== null);
  audioDrop.classList.toggle("filled", audioFile !== null);
  generateBtn.disabled = !(imageFile && audioFile);
  if (imageFile && audioFile) {
    renderPreview(imageFile, audioFile, imageHost, audioEl);
    const canvas = imageHost.querySelector<HTMLCanvasElement>("#vizCanvas");
    if (canvas) previewViz.attach(canvas);
    previewViz.setStyle(readVizStyle(vizSelect.value));
    previewViz.setLayout(vizLayout);
  }
}
```

- [ ] **Step 4: Confirm `previewViz` creation ordering in `main.ts`**

`const previewViz = createPreviewViz(audioEl);` must appear ABOVE `updateVizLayout` (which references it) and above `refresh`. It is created once after the element queries. If the existing line is below those, move it up. No second instance.

- [ ] **Step 5: Update CSS + verify `preview.ts` (`style.css`, `preview.ts`)**

In `src/style.css`, make `#imageHost` clip and strip the fixed size/position from `#vizCanvas` (position + pointer-events only — size/place now come from JS inline styles). Replace the current `#imageHost` and `#vizCanvas` rules:

```css
#imageHost {
  position: relative;
  line-height: 0;
  overflow: hidden;
  border-radius: var(--radius);
}

#vizCanvas {
  position: absolute;
  pointer-events: none;
}
```

Add a small rule for the slider row (place near `.controls`):

```css
.sliders {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem 1rem;
  margin-top: 0.75rem;
}
.slider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--muted);
}
.slider input[type="range"] {
  flex: 1;
}
.slider span {
  width: 3ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

Then open `src/preview.ts` and confirm `renderPreview` still creates and appends `<canvas id="vizCanvas">` into `imageHost` (added in the prior plan). No change needed unless it's missing; if missing, append it after the `<img>`:

```typescript
  const canvas = document.createElement("canvas");
  canvas.id = "vizCanvas";
  imageHost.append(canvas);
```

- [ ] **Step 6: Build**

Run: `pnpm build`
Expected: PASS — tsc clean (the new required `vizLayout` field is satisfied by `buildInput`; `setLayout` is on the `previewViz` type).

- [ ] **Step 7: Manual browser smoke**

Run: `pnpm dev`, open in Chrome.
1. Drop a static image + audio. Pick **Frequency bars**, press play — bars animate in the default bottom strip.
2. Drag **Y** down/up → the band moves vertically, live. Drag **X** → moves horizontally.
3. Drag **W** / **H** → the band resizes, live; value labels update.
4. Make a small box in a corner (e.g. X 60 / Y 5 / W 35 / H 25) → overlay sits there, clipped to the image.
5. Confirm the console is clean throughout.

(Export coordinates were re-validated against native ffmpeg for default/corner/top-left/mid boxes; the exported MP4 honors the same `vizLayout`.)

- [ ] **Step 8: Commit**

```bash
git add src/encode.ts src/preview-viz.ts src/main.ts src/style.css src/preview.ts
git commit -m "feat: x/y/w/h sliders to reposition and resize the visualizer"
```

---

## Self-Review

**Spec coverage:**
- `VizLayout` + `DEFAULT_VIZ_LAYOUT` (default = current look) → Task 1 Step 3. ✓
- Parameterized `scale2ref`/`overlay` → Task 1 Step 3, asserted in Step 1. ✓
- `w`/`h` clamp ≥0.01 → Task 2 Step 3 (`Math.max(0.01, ...)`) + slider `min=1`. ✓
- `none` path unchanged → Task 1 Step 3 (untouched `if` branches). ✓
- `EncodeInput.vizLayout` + pass-through → Task 2 Step 1. ✓
- `setLayout` positions canvas; applied on attach → Task 2 Step 2. ✓
- `#imageHost` overflow clip; `#vizCanvas` fixed-size CSS removed → Task 2 Step 5. ✓
- Four sliders + labels + live update + state + buildInput → Task 2 Step 3. ✓
- Deterministic number formatting → Task 1 `fmt`. ✓
- TDD for encode-args; browser smoke for preview → Task 1 Steps 1-4, Task 2 Step 7. ✓

**Placeholder scan:** None. All code complete.

**Type consistency:** `VizLayout`/`DEFAULT_VIZ_LAYOUT` defined in Task 1, imported in encode.ts, preview-viz.ts, main.ts (Task 2). `buildVizComplex(style, layout?)` / builders' `(…, style?, layout?)` signatures match between Task 1 definition and Task 2 (encode.ts) use. `vizLayout` field name consistent across encode.ts types, buildInput returns, and the builder calls. `setLayout` signature matches between preview-viz.ts definition and main.ts calls. Slider ids (`vizX/Y/W/H`, `viz{X,Y,W,H}val`) consistent between markup, queries, and CSS.
