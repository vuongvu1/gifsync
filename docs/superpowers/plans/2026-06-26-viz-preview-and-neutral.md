# Visualizer Live Preview + Neutral Styles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the colorful spectrum style (keep neutral-gray bars + waveform) and add a live, audio-synced canvas preview of the chosen visualizer.

**Architecture:** Two parts. (1) `encode-args.ts` loses the `spectrum` `VizStyle` member and recolors the two remaining ffmpeg filters to gray. (2) A new `preview-viz.ts` module renders a Web Audio (`AnalyserNode`) + canvas approximation overlaid on the preview image, driven by the existing `<audio>` element's playback; `main.ts` wires it and `preview.ts` adds the canvas to the layout.

**Tech Stack:** TypeScript, Vite, ffmpeg.wasm, Web Audio API, Canvas 2D, Vitest. No new dependencies.

## Global Constraints

- No new dependencies. No React.
- `VizStyle` is exactly `"none" | "bars" | "waveform"` after this plan (spectrum removed everywhere: type, `VIZ_FILTERS`, dropdown `<option>`s, `VIZ_STYLES` guard).
- Neutral palette only: ffmpeg filters use `colors=gray`; the canvas preview uses a translucent dark band (`rgba(0,0,0,0.45)`) with light-gray (`rgba(255,255,255,0.85)`) bars/line.
- Arg builders stay pure functions.
- `buildVizComplex` filtergraph shape is unchanged — only the per-style filter strings change. Validated gray strings (confirmed against native ffmpeg): `showfreqs=mode=bar:ascale=log:colors=gray`, `showwaves=mode=line:colors=gray`.
- Preview is an approximation (different FFT params than ffmpeg), not byte-identical — by design.
- Toolchain: pnpm; Node 18+ (`.nvmrc` pins lts/*; run `nvm use` if `node -v` < 18). Tests: `pnpm test`. Build: `pnpm build`.

---

### Task 1: Drop spectrum, neutralize colors

Remove the `spectrum` style and recolor the two remaining filters gray. Pure-function change + UI option/guard cleanup.

**Files:**
- Modify: `src/encode-args.ts`
- Modify: `src/encode-args.test.ts`
- Modify: `src/main.ts` (dropdown `<option>` + `VIZ_STYLES` guard list only)

**Interfaces:**
- Produces: `type VizStyle = "none" | "bars" | "waveform"`; `VIZ_FILTERS` keyed by `"bars" | "waveform"`; `buildVizComplex(style: Exclude<VizStyle, "none">): string` (signature unchanged).

- [ ] **Step 1: Update the failing tests**

In `src/encode-args.test.ts`, the `buildVizComplex` describe block currently has three `it`s (bars, waveform, spectrum) and asserts `showfreqs=mode=bar`. Replace that describe block and update the bars assertion to expect the gray color:

```typescript
describe("buildVizComplex", () => {
  it("splits audio, runs the gray bars filter, and overlays at the bottom", () => {
    const c = buildVizComplex("bars");
    expect(c).toContain("[1:a]asplit=2[aud][avis]");
    expect(c).toContain("showfreqs=mode=bar:ascale=log:colors=gray");
    expect(c).toContain("scale2ref=w=main_w:h=main_h/4[viz][bg2]");
    expect(c).toContain("overlay=x=(W-w)/2:y=H-h[vout]");
  });
  it("uses the gray showwaves filter for the waveform style", () => {
    expect(buildVizComplex("waveform")).toContain("showwaves=mode=line:colors=gray");
  });
});
```

Also delete the spectrum assertion in the `buildAnimatedArgs with a visualizer` describe block — it currently calls `buildAnimatedArgs("audio.mp3", "out.mp4", "spectrum")`. Change `"spectrum"` to `"waveform"`:

```typescript
describe("buildAnimatedArgs with a visualizer", () => {
  it("emits filter_complex and maps the composited streams", () => {
    const args = buildAnimatedArgs("audio.mp3", "out.mp4", "waveform");
    expect(args).toContain("-filter_complex");
    expect(args).toContain(buildVizComplex("waveform"));
    expect(args).toEqual(expect.arrayContaining(["-map", "[vout]"]));
    expect(args).not.toContain("-vf");
  });
  it("is unchanged when style is none (default)", () => {
    expect(buildAnimatedArgs("audio.mp3", "out.mp4")).toContain("-vf");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- encode-args`
Expected: FAIL — bars test fails on the missing `:colors=gray` substring; the now-removed spectrum cases referenced by the old tests are gone.

- [ ] **Step 3: Update `encode-args.ts`**

Change the type (remove `"spectrum"`) and the `VIZ_FILTERS` record:

```typescript
export type VizStyle = "none" | "bars" | "waveform";

// Audio→video filter per style. Sizes don't matter here: scale2ref resizes
// the result to the image's width and a quarter of its height before overlay.
// Neutral gray, no color map.
const VIZ_FILTERS: Record<Exclude<VizStyle, "none">, string> = {
  bars: "showfreqs=mode=bar:ascale=log:colors=gray",
  waveform: "showwaves=mode=line:colors=gray",
};
```

Leave `buildVizComplex`, `buildStaticArgs`, `buildAnimatedArgs`, `EVEN_SCALE`, `computeRepeatCount`, `buildConcatList` otherwise unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- encode-args`
Expected: PASS — all tests green (the `none`/`-vf` tests and the two gray viz tests).

- [ ] **Step 5: Remove spectrum from the UI in `main.ts`**

Delete the spectrum `<option>` in the `app.innerHTML` template:

```html
      <select id="vizStyle">
        <option value="none">None</option>
        <option value="bars">Frequency bars</option>
        <option value="waveform">Waveform</option>
      </select>
```

And drop `"spectrum"` from the `VIZ_STYLES` guard list:

```typescript
const VIZ_STYLES: readonly VizStyle[] = ["none", "bars", "waveform"];
```

- [ ] **Step 6: Verify build**

Run: `pnpm build`
Expected: PASS — `tsc` clean (removing the union member doesn't orphan any reference).

- [ ] **Step 7: Commit**

```bash
git add src/encode-args.ts src/encode-args.test.ts src/main.ts
git commit -m "feat: drop spectrum style, neutral gray bars/waveform"
```

---

### Task 2: Live audio-synced preview

New `preview-viz.ts` module + canvas overlay in the preview + main.ts wiring + CSS.

**Files:**
- Create: `src/preview-viz.ts`
- Modify: `src/preview.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `VizStyle` from `./encode-args` (Task 1); existing `audioEl`, `imageHost`, `vizSelect`, `readVizStyle` in main.ts.
- Produces: `createPreviewViz(audioEl: HTMLAudioElement): { attach(canvas: HTMLCanvasElement): void; setStyle(style: VizStyle): void }`.

- [ ] **Step 1: Create `src/preview-viz.ts`**

```typescript
import type { VizStyle } from "./encode-args";

// Live, audio-synced approximation of the exported visualizer. Web Audio's
// AnalyserNode feeds a canvas overlaid on the preview image. This is a preview,
// not a byte-match of ffmpeg's output — FFT params differ.
export function createPreviewViz(audioEl: HTMLAudioElement): {
  attach(canvas: HTMLCanvasElement): void;
  setStyle(style: VizStyle): void;
} {
  let canvas: HTMLCanvasElement | null = null;
  let style: VizStyle = "none";
  let rafId = 0;

  // Audio graph is created lazily on first play (AudioContext needs a gesture).
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let data: Uint8Array | null = null;

  function ensureAudio(): void {
    if (ctx) return;
    ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audioEl); // one-per-element, persists
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(ctx.destination); // keep the song audible
    data = new Uint8Array(analyser.frequencyBinCount);
  }

  function clear(): void {
    if (!canvas) return;
    const c = canvas.getContext("2d");
    if (c) c.clearRect(0, 0, canvas.width, canvas.height);
  }

  function draw(): void {
    rafId = requestAnimationFrame(draw);
    if (!canvas || !analyser || !data || style === "none") {
      clear();
      return;
    }
    // size backing store to the displayed size
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const c = canvas.getContext("2d");
    if (!c) return;

    c.clearRect(0, 0, w, h);
    c.fillStyle = "rgba(0,0,0,0.45)"; // translucent band, mirrors export
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(255,255,255,0.85)";
    c.strokeStyle = "rgba(255,255,255,0.85)";

    if (style === "bars") {
      analyser.getByteFrequencyData(data);
      const bars = 48;
      const step = Math.floor(data.length / bars) || 1;
      const bw = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] / 255;
        const bh = v * h;
        c.fillRect(i * bw, h - bh, bw * 0.7, bh);
      }
    } else {
      analyser.getByteTimeDomainData(data);
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = (data[i] / 255) * h;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }

  function start(): void {
    ensureAudio();
    if (ctx && ctx.state === "suspended") void ctx.resume();
    if (!rafId) draw();
  }
  function stop(): void {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    clear();
  }

  audioEl.addEventListener("play", start);
  audioEl.addEventListener("pause", stop);
  audioEl.addEventListener("ended", stop);

  return {
    attach(c: HTMLCanvasElement): void {
      canvas = c;
      if (audioEl.paused) clear();
    },
    setStyle(s: VizStyle): void {
      style = s;
      if (s === "none" || audioEl.paused) clear();
    },
  };
}
```

- [ ] **Step 2: Add the canvas to the preview in `src/preview.ts`**

In `renderPreview`, after appending the `<img>`, set the img to fill the host and append a fresh canvas. Replace the image-append block:

```typescript
  imageHost.replaceChildren();
  const img = document.createElement("img");
  img.src = lastImageUrl;
  img.alt = "preview";
  img.style.width = "100%";
  img.style.display = "block";
  imageHost.append(img);

  const canvas = document.createElement("canvas");
  canvas.id = "vizCanvas";
  imageHost.append(canvas);

  audioEl.src = lastAudioUrl;
```

(The `imageHost`/`audioEl` parameters and the URL bookkeeping above this block are unchanged.)

- [ ] **Step 3: Wire `previewViz` in `src/main.ts`**

Add the import near the other imports:

```typescript
import { createPreviewViz } from "./preview-viz";
```

Create the instance once, after the element queries (e.g. just below the `downloadEl` query):

```typescript
const previewViz = createPreviewViz(audioEl);
```

In `refresh()`, after the `renderPreview(...)` call, attach the freshly-created canvas and push the current style:

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
  }
}
```

Add a change listener for the dropdown (place it near the other `addEventListener` calls, after the `vizSelect` query exists):

```typescript
vizSelect.addEventListener("change", () => {
  previewViz.setStyle(readVizStyle(vizSelect.value));
});
```

- [ ] **Step 4: Add the overlay CSS in `src/style.css`**

Replace the existing `#preview img` rule with the host/overlay rules:

```css
#imageHost {
  position: relative;
  line-height: 0;
}

#preview img {
  border-radius: var(--radius);
  max-width: 100%;
}

#vizCanvas {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 30%;
  pointer-events: none;
  border-bottom-left-radius: var(--radius);
  border-bottom-right-radius: var(--radius);
}
```

- [ ] **Step 5: Build**

Run: `pnpm build`
Expected: PASS — tsc clean, Vite builds. (`createMediaElementSource`/`AnalyserNode` are in the DOM lib types; no `any` needed.)

- [ ] **Step 6: Manual browser smoke**

Run: `pnpm dev`, open in Chrome.
1. Drop a static image + an audio file. Preview shows the image.
2. Pick **Frequency bars**, press play on the audio player.
   Expected: a translucent dark band at the bottom ~30% of the image with light-gray bars animating to the music; console clean.
3. Switch to **Waveform** while playing.
   Expected: the bars are replaced by a light-gray waveform line, live.
4. Switch to **None**, or pause.
   Expected: the overlay clears (no band, no bars).
5. Swap the image for an animated GIF.
   Expected: preview re-renders, overlay still works after pressing play.

If the overlay never appears: confirm `createMediaElementSource` is called exactly once (a second call on the same element throws — check console). If it throws, the `ensureAudio` guard (`if (ctx) return`) is the fix and should already prevent it.

- [ ] **Step 7: Commit**

```bash
git add src/preview-viz.ts src/preview.ts src/main.ts src/style.css
git commit -m "feat: live audio-synced visualizer preview"
```

---

## Self-Review

**Spec coverage:**
- Drop spectrum, gray colors → Task 1. ✓
- Remove spectrum from dropdown + `VIZ_STYLES` → Task 1 Step 5. ✓
- `preview-viz.ts` Web Audio + canvas, lazy AudioContext on play, source→analyser→destination → Task 2 Step 1. ✓
- bars=`getByteFrequencyData`, waveform=`getByteTimeDomainData`, neutral band+gray → Task 2 Step 1. ✓
- clear on pause/ended/none → Task 2 Step 1 (`stop`, `setStyle`). ✓
- canvas overlay in `renderPreview`, img width:100% → Task 2 Step 2. ✓
- main.ts `createPreviewViz` once, attach on render, setStyle on change → Task 2 Step 3. ✓
- CSS `#imageHost` relative + `#vizCanvas` overlay → Task 2 Step 4. ✓
- encode-args TDD; preview-viz manual smoke → Task 1 Steps 1-4, Task 2 Step 6. ✓

**Placeholder scan:** None. All steps carry complete code.

**Type consistency:** `VizStyle` narrowed to 3 members in Task 1, imported in `preview-viz.ts` (Task 2); `createPreviewViz(audioEl) → { attach, setStyle }` matches between Task 2 Step 1 (definition) and Step 3 (use); `#vizCanvas` id consistent between preview.ts (create), main.ts (query), style.css (rule). `readVizStyle` (pre-existing) returns `VizStyle` and is reused, consistent with the narrowed union.
