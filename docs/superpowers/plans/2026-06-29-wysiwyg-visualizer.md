# WYSIWYG Visualizer (single renderer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the exported visualizer pixel-match the preview by rendering the export's visualizer frames in-browser with the same draw code, overlaying them in ffmpeg instead of `showfreqs`/`showwaves`; default the style to Frequency bars.

**Architecture:** Extract the bar/line drawing into a shared `viz-draw.ts` used by both the live preview and a new offline renderer `viz-frames.ts` (decode audio → per-frame FFT via `fft.ts` for bars / PCM windows for waveform → draw → PNG). ffmpeg overlays that PNG sequence onto the looped/animated image; the `showfreqs` filter path is removed.

**Tech Stack:** TypeScript, Vite, ffmpeg.wasm, Web Audio (`decodeAudioData`), Canvas, Vitest. No new dependencies.

## Global Constraints

- No new dependencies. No React. Pure-function modules stay DOM-free (`fft.ts`, `encode-args.ts`).
- Visualizer frame rate = **15 fps** (`fps` is passed explicitly; no magic literals in the filtergraph).
- Frame filenames: `viz_%05d.png` (5-digit, `String(i).padStart(5,"0")`).
- Output dims even-floored to match ffmpeg `trunc(iw/2)*2`: `even = d - (d % 2)`.
- Box px from layout: `boxW = max(1, round(w*evenW))`, `boxH = max(1, round(h*evenH))`; overlay `x = round(x*evenW)`, `y = round(y*evenH)`.
- Export filtergraph (validated natively): `[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];[bg][1:v]overlay=x=X:y=Y:shortest=1[vout]`, inputs `[0]` image/concat, `[1]` `-framerate 15 -i viz_%05d.png`, `[2]` audio; map `[vout]` + `2:a`.
- Default visualizer style = `bars`.
- `none` path emits today's exact args (no viz input/overlay).
- Shared draw is identical for preview and export: gray bars/line `rgba(255,255,255,0.85)`, 48 bars `bw*0.7` wide, waveform line width 2.
- Toolchain: pnpm; Node 18+ (`node -v`; if < 18 `nvm use`). Tests: `pnpm test`. Build: `pnpm build`.

---

### Task 1: `fft.ts` — radix-2 FFT (pure, TDD)

**Files:**
- Create: `src/fft.ts`
- Test: `src/fft.test.ts`

**Interfaces:**
- Produces: `export function fft(re: Float32Array, im: Float32Array): void` — in-place; length must be a power of two.

- [ ] **Step 1: Write the failing tests**

Create `src/fft.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { fft } from "./fft";

function mag(re: Float32Array, im: Float32Array, k: number): number {
  return Math.hypot(re[k], im[k]);
}

describe("fft", () => {
  it("throws when length is not a power of two", () => {
    expect(() => fft(new Float32Array(3), new Float32Array(3))).toThrow();
  });

  it("transforms a DC signal to a single bin-0 spike", () => {
    const re = new Float32Array([1, 1, 1, 1]);
    const im = new Float32Array(4);
    fft(re, im);
    expect(re[0]).toBeCloseTo(4, 5); // sum of samples
    expect(mag(re, im, 1)).toBeCloseTo(0, 5);
    expect(mag(re, im, 2)).toBeCloseTo(0, 5);
    expect(mag(re, im, 3)).toBeCloseTo(0, 5);
  });

  it("puts a pure cosine's energy at its frequency bin", () => {
    const n = 8;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 1 * i) / n); // bin 1
    fft(re, im);
    // cosine of bin k => peaks at k and n-k, each magnitude n/2
    expect(mag(re, im, 1)).toBeCloseTo(n / 2, 4);
    expect(mag(re, im, n - 1)).toBeCloseTo(n / 2, 4);
    expect(mag(re, im, 2)).toBeCloseTo(0, 4);
    expect(mag(re, im, 3)).toBeCloseTo(0, 4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- fft`
Expected: FAIL — `fft` not found.

- [ ] **Step 3: Implement `src/fft.ts`**

```typescript
// In-place iterative radix-2 Cooley–Tukey FFT. `re`/`im` are the real and
// imaginary parts; both must have the same power-of-two length.
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error("fft length must be a power of two");

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k;
        const b = a + (len >> 1);
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- fft`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/fft.ts src/fft.test.ts
git commit -m "feat: pure radix-2 FFT for offline visualizer analysis"
```

---

### Task 2: `viz-draw.ts` — shared draw + refactor preview

Extract the bar/line drawing so preview and export use the exact same code.

**Files:**
- Create: `src/viz-draw.ts`
- Modify: `src/preview-viz.ts`

**Interfaces:**
- Produces: `drawBars(ctx, w, h, freq: Uint8Array)`, `drawWave(ctx, w, h, time: Uint8Array)`.
- Consumed by `preview-viz.ts` (Task 2) and `viz-frames.ts` (Task 3).

- [ ] **Step 1: Create `src/viz-draw.ts`**

```typescript
// Shared visualizer drawing — identical in the live preview and the exported
// frames, so what you see is what you get. The caller clears/sizes the canvas;
// these only paint the bars/line (gray, transparent background).

export function drawBars(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  freq: Uint8Array,
): void {
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const bars = 48;
  const step = Math.floor(freq.length / bars) || 1;
  const bw = w / bars;
  for (let i = 0; i < bars; i++) {
    const v = freq[i * step] / 255;
    const bh = v * h;
    ctx.fillRect(i * bw, h - bh, bw * 0.7, bh);
  }
}

export function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: Uint8Array,
): void {
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < time.length; i++) {
    const x = (i / (time.length - 1)) * w;
    const y = (time[i] / 255) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
```

- [ ] **Step 2: Refactor `preview-viz.ts` to use the shared draw**

Add the import at the top (after the existing import):

```typescript
import { drawBars, drawWave } from "./viz-draw";
```

In `render()`, replace the live-draw block (the part after `if (!live || !analyser || !data) return;` that sets fill/stroke styles and contains the `if (style === "bars") { ... } else { ... }` bars/line drawing) with:

```typescript
    if (!live || !analyser || !data) return; // paused: outline + handle only

    if (style === "bars") {
      analyser.getByteFrequencyData(data);
      drawBars(c, w, h, data);
    } else {
      analyser.getByteTimeDomainData(data);
      drawWave(c, w, h, data);
    }
```

(The outline + handle drawing earlier in `render()` is unchanged; only the bars/line section moves to `viz-draw`.)

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: PASS — tsc clean.

- [ ] **Step 4: Commit**

```bash
git add src/viz-draw.ts src/preview-viz.ts
git commit -m "refactor: shared viz-draw module for preview bars/waveform"
```

---

### Task 3: `viz-frames.ts` — offline frame renderer

Generates the export's PNG frames from the audio, deterministically, using `fft` + `viz-draw`.

**Files:**
- Create: `src/viz-frames.ts`

**Interfaces:**
- Consumes: `fft` (Task 1), `drawBars`/`drawWave` (Task 2).
- Produces: `renderVizFrames(audio: Blob, style: "bars" | "waveform", boxW: number, boxH: number, fps: number, onProgress?: (done: number, total: number) => void): Promise<Uint8Array[]>`.

- [ ] **Step 1: Create `src/viz-frames.ts`**

```typescript
import { fft } from "./fft";
import { drawBars, drawWave } from "./viz-draw";

const FFT_SIZE = 512;
const BINS = FFT_SIZE / 2; // 256
const MIN_DB = -100;
const MAX_DB = -30;
const SMOOTH = 0.8; // matches AnalyserNode.smoothingTimeConstant default

function blackman(i: number, n: number): number {
  return 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
}

async function decodeMono(audio: Blob): Promise<{ pcm: Float32Array; sampleRate: number; duration: number }> {
  const buf = await audio.arrayBuffer();
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const ab = await ctx.decodeAudioData(buf);
    const out = new Float32Array(ab.length);
    const ch = ab.numberOfChannels;
    for (let c = 0; c < ch; c++) {
      const d = ab.getChannelData(c);
      for (let i = 0; i < ab.length; i++) out[i] += d[i] / ch;
    }
    return { pcm: out, sampleRate: ab.sampleRate, duration: ab.duration };
  } finally {
    void ctx.close();
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) return reject(new Error("canvas.toBlob failed"));
      b.arrayBuffer().then((ab) => resolve(new Uint8Array(ab)), reject);
    }, "image/png");
  });
}

// Renders one PNG per output frame covering the full audio duration. Bars use an
// FFT (mirroring AnalyserNode.getByteFrequencyData); waveform uses PCM windows
// (mirroring getByteTimeDomainData). Same draw code as the live preview.
export async function renderVizFrames(
  audio: Blob,
  style: "bars" | "waveform",
  boxW: number,
  boxH: number,
  fps: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array[]> {
  const { pcm, sampleRate, duration } = await decodeMono(audio);
  const total = Math.max(1, Math.ceil(duration * fps));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(boxW));
  canvas.height = Math.max(1, Math.round(boxH));
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Could not get a 2D canvas context for the visualizer.");

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const freq = new Uint8Array(BINS);
  const smooth = new Float32Array(BINS);
  const time = new Uint8Array(FFT_SIZE);

  const frames: Uint8Array[] = [];
  for (let f = 0; f < total; f++) {
    const start = Math.floor((f / fps) * sampleRate);
    c.clearRect(0, 0, canvas.width, canvas.height);

    if (style === "bars") {
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = start + i < pcm.length ? pcm[start + i] : 0;
        re[i] = s * blackman(i, FFT_SIZE);
        im[i] = 0;
      }
      fft(re, im);
      for (let k = 0; k < BINS; k++) {
        const m = Math.hypot(re[k], im[k]) / FFT_SIZE;
        smooth[k] = SMOOTH * smooth[k] + (1 - SMOOTH) * m;
        const db = smooth[k] > 0 ? 20 * Math.log10(smooth[k]) : MIN_DB;
        const norm = (db - MIN_DB) / (MAX_DB - MIN_DB);
        freq[k] = Math.max(0, Math.min(255, Math.round(norm * 255)));
      }
      drawBars(c, canvas.width, canvas.height, freq);
    } else {
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = start + i < pcm.length ? pcm[start + i] : 0;
        time[i] = Math.max(0, Math.min(255, Math.round(128 + s * 128)));
      }
      drawWave(c, canvas.width, canvas.height, time);
    }

    frames.push(await canvasToPng(canvas));
    onProgress?.(f + 1, total);
  }
  return frames;
}
```

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: PASS — tsc clean (module compiles; not wired yet).

- [ ] **Step 3: Commit**

```bash
git add src/viz-frames.ts
git commit -m "feat: offline visualizer frame renderer (FFT + shared draw)"
```

---

### Task 4: Export rewrite — overlay PNG sequence (encode-args + encode + main)

The coupled change that swaps the export from `showfreqs` to the PNG-sequence overlay and wires frame generation. Signatures ripple across three files, so they change together to keep the build green.

**Files:**
- Modify: `src/encode-args.ts`
- Test: `src/encode-args.test.ts`
- Modify: `src/encode.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `type VizArgs = { x: number; y: number; fps: number }`; `buildStaticArgs(imageName, audioName, out, viz?: VizArgs)`; `buildAnimatedArgs(audioName, out, viz?: VizArgs)`.
- `EncodeInput.viz: { frames: Uint8Array[]; x: number; y: number; fps: number } | null`.
- Consumes: `renderVizFrames` (Task 3), `DEFAULT_VIZ_LAYOUT`/`VizStyle`/`VizLayout` (encode-args).

- [ ] **Step 1: Rewrite the `encode-args.ts` tests**

Replace the `buildVizComplex`, `buildStaticArgs with a visualizer`, and `buildAnimatedArgs with a visualizer` describe blocks (the showfreqs/colorkey/scale2ref ones) with the overlay-sequence tests below. Keep the `none` tests, `computeRepeatCount`, `buildConcatList`, and `DEFAULT_VIZ_LAYOUT` tests. Remove `buildVizComplex` from the import list.

```typescript
describe("buildStaticArgs with a visualizer", () => {
  it("adds the viz PNG sequence input and overlays it", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", { x: 10, y: 200, fps: 15 });
    expect(args).toEqual(expect.arrayContaining(["-framerate", "15"]));
    expect(args).toContain("viz_%05d.png");
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];[bg][1:v]overlay=x=10:y=200:shortest=1[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "[vout]"]));
    expect(args).toEqual(expect.arrayContaining(["-map", "2:a"]));
    expect(args).not.toContain("-vf");
  });
  it("is unchanged when no visualizer (default)", () => {
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).toContain("-vf");
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).not.toContain("viz_%05d.png");
  });
});

describe("buildAnimatedArgs with a visualizer", () => {
  it("adds the viz PNG sequence input and overlays it", () => {
    const args = buildAnimatedArgs("audio.mp3", "out.mp4", { x: 0, y: 5, fps: 15 });
    expect(args).toEqual(expect.arrayContaining(["-framerate", "15"]));
    expect(args).toContain("viz_%05d.png");
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];[bg][1:v]overlay=x=0:y=5:shortest=1[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "2:a"]));
    expect(args).not.toContain("-vf");
  });
  it("is unchanged when no visualizer (default)", () => {
    expect(buildAnimatedArgs("audio.mp3", "out.mp4")).toContain("-vf");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- encode-args`
Expected: FAIL — old `buildVizComplex` import gone / new arg shapes not emitted.

- [ ] **Step 3: Rewrite `encode-args.ts`**

Remove `fmt`, `VIZ_FILTERS`, and `buildVizComplex`. Keep `EVEN_SCALE`, `VizStyle`, `VizLayout`, `DEFAULT_VIZ_LAYOUT`, `computeRepeatCount`, `buildConcatList`. Add `VizArgs` and rewrite the two builders:

```typescript
const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export type VizStyle = "none" | "bars" | "waveform";

export type VizLayout = { x: number; y: number; w: number; h: number };

// Bottom strip, full width, quarter height — the default box.
export const DEFAULT_VIZ_LAYOUT: VizLayout = { x: 0, y: 0.75, w: 1, h: 0.25 };

// Integer overlay coords (px) + frame rate for the pre-rendered viz PNG sequence.
export type VizArgs = { x: number; y: number; fps: number };

const VIZ_OVERLAY = (x: number, y: number) =>
  `[0:v]${EVEN_SCALE}[bg];[bg][1:v]overlay=x=${x}:y=${y}:shortest=1[vout]`;

export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
  viz?: VizArgs,
): string[] {
  if (!viz) {
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
    "-framerate", String(viz.fps),
    "-i", "viz_%05d.png",
    "-i", audioName,
    "-filter_complex", VIZ_OVERLAY(viz.x, viz.y),
    "-map", "[vout]",
    "-map", "2:a",
    "-tune", "stillimage",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  ];
}

export function buildAnimatedArgs(
  audioName: string,
  out: string,
  viz?: VizArgs,
): string[] {
  if (!viz) {
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
    "-framerate", String(viz.fps),
    "-i", "viz_%05d.png",
    "-i", audioName,
    "-filter_complex", VIZ_OVERLAY(viz.x, viz.y),
    "-map", "[vout]",
    "-map", "2:a",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  ];
}
```

Keep `computeRepeatCount` and `buildConcatList` below, unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- encode-args`
Expected: PASS.

- [ ] **Step 5: Rewrite `encode.ts` to carry + write viz frames**

Update the imports (drop `VizStyle`/`VizLayout`, add `VizArgs`):

```typescript
import type { VizArgs } from "./encode-args";
import {
  buildAnimatedArgs,
  buildConcatList,
  buildStaticArgs,
  computeRepeatCount,
} from "./encode-args";
```

Replace the `visualizer`/`vizLayout` fields on BOTH `StaticInput` and `AnimatedInput` with:

```typescript
  viz: { frames: Uint8Array[]; x: number; y: number; fps: number } | null;
```

Add this helper near the top of the module (after `CORE_BASE`):

```typescript
function vizName(i: number): string {
  return `viz_${String(i).padStart(5, "0")}.png`;
}
```

In `encode()`, replace the static branch's arg line and the animated branch's arg line, writing frames first. Static branch becomes:

```typescript
  if (input.kind === "static") {
    await ffmpeg.writeFile(input.imageName, input.image);
    fsFiles.push(input.imageName);
    await ffmpeg.writeFile(input.audioName, input.audio);
    fsFiles.push(input.audioName);
    if (input.viz) {
      for (let i = 0; i < input.viz.frames.length; i++) {
        const name = vizName(i);
        await ffmpeg.writeFile(name, input.viz.frames[i]);
        fsFiles.push(name);
      }
    }
    args = buildStaticArgs(
      input.imageName,
      input.audioName,
      "out.mp4",
      input.viz ? { x: input.viz.x, y: input.viz.y, fps: input.viz.fps } : undefined,
    );
  } else {
```

And the animated branch's final arg line becomes (after writing the concat frames, list.txt, and audio as today, ALSO write viz frames):

```typescript
    await ffmpeg.writeFile("list.txt", new TextEncoder().encode(list));
    fsFiles.push("list.txt");
    if (input.viz) {
      for (let i = 0; i < input.viz.frames.length; i++) {
        const name = vizName(i);
        await ffmpeg.writeFile(name, input.viz.frames[i]);
        fsFiles.push(name);
      }
    }
    args = buildAnimatedArgs(
      input.audioName,
      "out.mp4",
      input.viz ? { x: input.viz.x, y: input.viz.y, fps: input.viz.fps } : undefined,
    );
  }
```

(The `fsFiles` cleanup in `finally` already deletes everything pushed, including the viz frames.)

- [ ] **Step 6: Rewrite the `main.ts` visualizer flow**

(a) Imports — drop `VizLayout` only if unused; you still need `VizStyle`, `VizLayout`, `DEFAULT_VIZ_LAYOUT`. Add the frame renderer:

```typescript
import { renderVizFrames } from "./viz-frames";
import { type VizStyle, type VizLayout, DEFAULT_VIZ_LAYOUT } from "./encode-args";
```

(b) Default style — add `selected` to the bars option in the template:

```html
        <option value="bars" selected>Frequency bars</option>
```

(c) Replace `buildInput` so it takes the prepared `viz` object instead of style+layout:

```typescript
type VizData = { frames: Uint8Array[]; x: number; y: number; fps: number } | null;

async function buildInput(image: File, audio: File, viz: VizData): Promise<EncodeInput> {
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const audioName = `audio${ext(audio)}`;
  const animatedType = image.type === "image/gif" || image.type === "image/webp";
  if (animatedType) {
    const frames = await decodeAnimated(image);
    if (frames.length > 1) {
      const audioDurationSec = await getAudioDuration(audio);
      return { kind: "animated", frames, audio: audioBytes, audioName, audioDurationSec, viz };
    }
  }
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  return {
    kind: "static",
    image: imageBytes,
    imageName: `image${ext(image)}`,
    audio: audioBytes,
    audioName,
    viz,
  };
}
```

(d) Add a helper that renders the viz frames for the current selection (place after `readVizStyle`):

```typescript
const VIZ_FPS = 15;

async function prepareViz(image: File, audio: File): Promise<VizData> {
  const style = readVizStyle(vizSelect.value);
  if (style === "none") return null;
  const bmp = await createImageBitmap(image);
  const evenW = bmp.width - (bmp.width % 2);
  const evenH = bmp.height - (bmp.height % 2);
  bmp.close();
  const boxW = Math.max(1, Math.round(vizLayout.w * evenW));
  const boxH = Math.max(1, Math.round(vizLayout.h * evenH));
  const x = Math.round(vizLayout.x * evenW);
  const y = Math.round(vizLayout.y * evenH);
  const frames = await renderVizFrames(audio, style, boxW, boxH, VIZ_FPS, (done, total) => {
    statusEl.textContent = `Rendering visualizer… ${done}/${total}`;
  });
  return { frames, x, y, fps: VIZ_FPS };
}
```

(e) In the generate click handler, replace the line that builds the input. Where it currently does:

```typescript
    const input = await buildInput(imageFile, audioFile, readVizStyle(vizSelect.value), vizLayout);
```

replace with (render viz frames first, with status):

```typescript
    const viz = await prepareViz(imageFile, audioFile);
    statusEl.textContent = "Decoding…";
    const input = await buildInput(imageFile, audioFile, viz);
```

(The existing `statusEl.textContent = "Encoding…"` line right after stays.)

- [ ] **Step 7: Build + unit tests**

Run: `pnpm build && pnpm test`
Expected: PASS — tsc clean (every `EncodeInput` now has `viz`; no dangling `visualizer`/`vizLayout`/`buildVizComplex` references), all unit tests green.

- [ ] **Step 8: Commit**

```bash
git add src/encode-args.ts src/encode-args.test.ts src/encode.ts src/main.ts
git commit -m "feat: export visualizer via in-browser frame sequence; default bars"
```

---

### Task 5: Integration smoke + final review

**Files:** none (verification only).

- [ ] **Step 1: Browser smoke**

Run: `pnpm dev`, open in Chrome.
1. Drop a static image + audio. Confirm the dropdown defaults to **Frequency bars** and the preview shows the bars box.
2. Click Generate. Confirm the status shows "Rendering visualizer… i/N", then "Encoding…", then a downloadable MP4.
3. Open the MP4 and a paused preview side by side: the bars should look the **same** (48 chunky gray bars in the same box), not ffmpeg's thin spikes.
4. Repeat with **Waveform**, and once with an animated GIF + audio.
5. Set **None** → exported video has no visualizer; console clean throughout.

- [ ] **Step 2: Native filtergraph sanity (optional, already validated)**

The overlay-sequence args were validated against native ffmpeg (image loop + `-framerate 15 -i viz_%05d.png` + audio → overlay → output spans the viz duration). No action unless Step 1 reveals a filter error.

- [ ] **Step 3: Final whole-branch review**

Dispatch the final reviewer over the branch diff (most capable model). Confirm: preview and export share `viz-draw`; no `showfreqs`/`buildVizComplex` remnants; `EncodeInput.viz` threaded; frame cleanup in `encode.ts`; default bars; fps not hard-coded in the filtergraph string.

---

## Self-Review

**Spec coverage:**
- One renderer (`viz-draw` shared) → Task 2. ✓
- `fft.ts` pure + tested → Task 1. ✓
- `viz-frames.ts` offline gen (decode, FFT bars, PCM waveform, draw, PNG) → Task 3. ✓
- Export overlay of PNG sequence; showfreqs/colorkey/scale2ref removed → Task 4 (encode-args). ✓
- `EncodeInput.viz` + frame write/cleanup → Task 4 (encode.ts). ✓
- Output dims via createImageBitmap even-floored; box px; integer overlay → Task 4 (main `prepareViz`). ✓
- Default = bars → Task 4 Step 6(b). ✓
- 15 fps, progress status → Task 4 (`VIZ_FPS`, `prepareViz` onProgress). ✓
- Tests: fft + encode-args unit; preview/frames browser smoke → Tasks 1,4,5. ✓

**Placeholder scan:** None. Complete code for new files; precise edits otherwise.

**Type consistency:** `VizArgs {x,y,fps}` matches between encode-args (def), encode.ts (call), and the `viz` object built in main. `EncodeInput.viz` shape `{frames,x,y,fps}|null` consistent across encode.ts types, `buildInput`, `prepareViz`, `VizData`. `renderVizFrames(audio,style,boxW,boxH,fps,onProgress)` matches between Task 3 def and Task 4 call. `drawBars`/`drawWave` signatures match between viz-draw (def), preview-viz, viz-frames. `fft(re,im)` matches Task 1 def and Task 3 use. Frame name `viz_%05d.png` ↔ `vizName` `padStart(5,"0")` consistent.

**Note:** `viz-frames.ts` and the `main.ts` flow can't be unit-tested under jsdom (Web Audio + canvas + createImageBitmap) — covered by the Task 5 browser smoke, with the export frame compared to the preview.
