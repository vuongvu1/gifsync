# UI Refresh (Radix look) + Music Visualizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle gifsync with the Radix visual aesthetic (no React) and bake an optional, user-selectable music visualizer into the exported MP4.

**Architecture:** Stay vanilla TS + Vite + ffmpeg.wasm. The visualizer is built entirely as an ffmpeg `filter_complex` string in `encode-args.ts` (audio → `showfreqs`/`showwaves`/`showspectrum`, overlaid on the image) — no Web Audio or canvas code. The UI gets a Radix-colors restyle of `style.css` plus one native `<select>` to pick the style.

**Tech Stack:** TypeScript, Vite, ffmpeg.wasm (`@ffmpeg/core-mt@0.12.10`), `@radix-ui/colors` (CSS variables only), Vitest.

## Global Constraints

- **No React, no framework.** Radix is used for its CSS color scales only.
- **Browser-only.** No backend; all encoding stays in ffmpeg.wasm.
- **Visualizer default = `none`** — existing behaviour unchanged unless a style is picked.
- **`VizStyle` type** (defined Task 1, used everywhere): `"none" | "bars" | "waveform" | "spectrum"`.
- **Arg builders stay pure functions** (no ffmpeg/DOM deps) so they remain unit-testable.
- New dependency must be CSS-only (`@radix-ui/colors`) — no impact on the existing COOP/COEP headers.

---

### Task 1: Visualizer arg builders

Add the `VizStyle` type, a `filter_complex` builder, and `style` params on the two arg builders. Pure functions — full TDD.

**Files:**
- Modify: `src/encode-args.ts`
- Test: `src/encode-args.test.ts`

**Interfaces:**
- Consumes: existing `EVEN_SCALE` constant, `buildStaticArgs`, `buildAnimatedArgs`.
- Produces:
  - `type VizStyle = "none" | "bars" | "waveform" | "spectrum"`
  - `buildVizComplex(style: Exclude<VizStyle, "none">): string`
  - `buildStaticArgs(imageName: string, audioName: string, out: string, style?: VizStyle): string[]` (style defaults to `"none"`)
  - `buildAnimatedArgs(audioName: string, out: string, style?: VizStyle): string[]` (style defaults to `"none"`)

- [ ] **Step 1: Write failing tests for the new behaviour**

Append to `src/encode-args.test.ts`:

```typescript
import {
  buildAnimatedArgs,
  buildConcatList,
  buildStaticArgs,
  buildVizComplex,
  computeRepeatCount,
} from "./encode-args";

describe("buildVizComplex", () => {
  it("splits audio, runs the bars filter, and overlays at the bottom", () => {
    const c = buildVizComplex("bars");
    expect(c).toContain("[1:a]asplit=2[aud][avis]");
    expect(c).toContain("showfreqs=mode=bar");
    expect(c).toContain("scale2ref=w=main_w:h=main_h/4[viz][bg2]");
    expect(c).toContain("overlay=x=(W-w)/2:y=H-h[vout]");
  });
  it("uses showwaves for the waveform style", () => {
    expect(buildVizComplex("waveform")).toContain("showwaves=mode=line");
  });
  it("uses showspectrum for the spectrum style", () => {
    expect(buildVizComplex("spectrum")).toContain("showspectrum");
  });
});

describe("buildStaticArgs with a visualizer", () => {
  it("emits filter_complex and maps the composited streams", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", "bars");
    expect(args).toContain("-filter_complex");
    expect(args).toContain(buildVizComplex("bars"));
    expect(args).toEqual(expect.arrayContaining(["-map", "[vout]"]));
    expect(args).toEqual(expect.arrayContaining(["-map", "[aud]"]));
    expect(args).not.toContain("-vf"); // filter_complex replaces -vf
  });
  it("is unchanged when style is none (default)", () => {
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).toEqual(
      buildStaticArgs("image.png", "audio.mp3", "out.mp4", "none"),
    );
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).toContain("-vf");
  });
});

describe("buildAnimatedArgs with a visualizer", () => {
  it("emits filter_complex and maps the composited streams", () => {
    const args = buildAnimatedArgs("audio.mp3", "out.mp4", "spectrum");
    expect(args).toContain("-filter_complex");
    expect(args).toContain(buildVizComplex("spectrum"));
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
Expected: FAIL — `buildVizComplex is not a function` and the new `buildStaticArgs`/`buildAnimatedArgs` style assertions fail.

- [ ] **Step 3: Implement the type, builder, and style params**

Edit `src/encode-args.ts`. Keep `EVEN_SCALE` at the top. Add the type + filters, and replace the two arg-builder bodies:

```typescript
const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export type VizStyle = "none" | "bars" | "waveform" | "spectrum";

// Audio→video filter per style. Sizes don't matter here: scale2ref resizes
// the result to the image's width and a quarter of its height before overlay.
const VIZ_FILTERS: Record<Exclude<VizStyle, "none">, string> = {
  bars: "showfreqs=mode=bar:ascale=log",
  waveform: "showwaves=mode=line",
  spectrum: "showspectrum=slide=scroll:color=intensity",
};

// asplit keeps one audio copy for the output mux ([aud]) and feeds the other
// ([avis]) to the visualizer; the viz video is scaled to the image (main_w/
// main_h via scale2ref) and overlaid as a bottom strip.
export function buildVizComplex(style: Exclude<VizStyle, "none">): string {
  return [
    "[1:a]asplit=2[aud][avis]",
    `[avis]${VIZ_FILTERS[style]}[viz0]`,
    `[0:v]${EVEN_SCALE}[bg]`,
    "[viz0][bg]scale2ref=w=main_w:h=main_h/4[viz][bg2]",
    "[bg2][viz]overlay=x=(W-w)/2:y=H-h[vout]",
  ].join(";");
}

export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
  style: VizStyle = "none",
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
    "-filter_complex", buildVizComplex(style),
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

export function buildAnimatedArgs(
  audioName: string,
  out: string,
  style: VizStyle = "none",
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
    "-filter_complex", buildVizComplex(style),
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

Leave `computeRepeatCount` and `buildConcatList` untouched below.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- encode-args`
Expected: PASS — all existing tests (the `none`/`-vf` ones) and the new visualizer tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/encode-args.ts src/encode-args.test.ts
git commit -m "feat: visualizer filter_complex builders (bars/waveform/spectrum)"
```

---

### Task 2: Wire the visualizer through encode + UI select (end-to-end + smoke validation)

Thread `VizStyle` from a new `<select>` through `buildInput` → `encode` → arg builders, then validate a real MP4 renders for each style. **This task contains the only real-ffmpeg validation** — if the bundled core lacks a filter, fix it here.

**Files:**
- Modify: `src/encode.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `VizStyle`, `buildStaticArgs(..., style)`, `buildAnimatedArgs(..., style)` from Task 1.
- Produces:
  - `StaticInput` and `AnimatedInput` each gain `visualizer: VizStyle`.
  - `buildInput(image: File, audio: File, visualizer: VizStyle): Promise<EncodeInput>` (in `main.ts`).

- [ ] **Step 1: Add `visualizer` to the encode input types and pass it to the builders**

Edit `src/encode.ts`. Add the import and the field, and pass it through:

```typescript
import type { VizStyle } from "./encode-args";
```

Add `visualizer: VizStyle;` to both `StaticInput` and `AnimatedInput` type definitions.

In `encode()`, update the two builder calls:

```typescript
    args = buildStaticArgs(input.imageName, input.audioName, "out.mp4", input.visualizer);
```
```typescript
    args = buildAnimatedArgs(input.audioName, "out.mp4", input.visualizer);
```

- [ ] **Step 2: Add the select to the markup and thread it through `buildInput`**

Edit `src/main.ts`.

Add the import:
```typescript
import type { VizStyle } from "./encode-args";
```

In the `app.innerHTML` template, insert a controls row between `#preview` and the `#generate` button:

```html
  <div class="controls">
    <label class="field">
      Visualizer
      <select id="vizStyle">
        <option value="none">None</option>
        <option value="bars">Frequency bars</option>
        <option value="waveform">Waveform</option>
        <option value="spectrum">Spectrum</option>
      </select>
    </label>
    <p class="hint">The visualizer is rendered into the exported video.</p>
  </div>
```

Add the query near the other element lookups:
```typescript
const vizSelect = app.querySelector<HTMLSelectElement>("#vizStyle")!;
```

Change `buildInput` to take the style and stamp it onto both return objects:
```typescript
async function buildInput(image: File, audio: File, visualizer: VizStyle): Promise<EncodeInput> {
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const audioName = `audio${ext(audio)}`;
  const animatedType = image.type === "image/gif" || image.type === "image/webp";
  if (animatedType) {
    const frames = await decodeAnimated(image);
    if (frames.length > 1) {
      const audioDurationSec = await getAudioDuration(audio);
      return { kind: "animated", frames, audio: audioBytes, audioName, audioDurationSec, visualizer };
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
  };
}
```

In the generate click handler, read the select and pass it in:
```typescript
    const input = await buildInput(imageFile, audioFile, vizSelect.value as VizStyle);
```

- [ ] **Step 3: Type-check / build**

Run: `pnpm build`
Expected: PASS — `tsc` reports no errors (the new `visualizer` field is required on every `EncodeInput`, so a missed call site would fail here).

- [ ] **Step 4: Smoke-test every style against real ffmpeg.wasm**

Run: `pnpm dev`, open the app in Chrome.

For each of `bars`, `waveform`, `spectrum`:
1. Drop a static image + an audio file.
2. Pick the style in the dropdown.
3. Click Generate, save the MP4, open it.

Expected: a valid MP4 plays with the song AND the visualizer band animated at the bottom quarter of the frame.

Also repeat once with an **animated GIF/WebP** + audio to confirm the concat path overlays correctly.

**If a style errors** (check the `#status` message — ffmpeg prints the failing filter):
- `showfreqs` missing → change `VIZ_FILTERS.bars` to `"showspectrum=mode=bar"` or fall back to `showspectrum`.
- `showspectrum` missing → set `VIZ_FILTERS.spectrum` to `"showwaves=mode=cline"`.
- `scale2ref` rejects `main_w` → try `rw`/`rh` instead, or `iw`/`ih` of the reference.
- If a filter is genuinely absent from the core, remove that `<option>` from the select and note it in `README.md`.

Re-run `pnpm test -- encode-args` after any `VIZ_FILTERS` edit to keep the structure tests green (update the `toContain` substring if you changed the filter name).

- [ ] **Step 5: Commit**

```bash
git add src/encode.ts src/main.ts
git commit -m "feat: pick visualizer style in UI and bake it into the MP4"
```

---

### Task 3: Radix-look UI restyle

Add `@radix-ui/colors`, restyle `style.css` with Radix tokens, add auto dark mode, and style the new select. Visual change only — no logic.

**Files:**
- Modify: `package.json` (via `pnpm add`)
- Modify: `src/style.css` (full rewrite)
- Modify: `src/main.ts` (color CSS imports + dark-mode toggle)

**Interfaces:**
- Consumes: the `.controls`, `.field`, `.hint`, `#vizStyle` markup added in Task 2; existing classes `.drop`, `.filled`, `.note`, `.error`, `#preview`, `#generate`, `#progress`.
- Produces: no exported symbols.

- [ ] **Step 1: Add the dependency**

Run: `pnpm add @radix-ui/colors`
Expected: `@radix-ui/colors` appears under `dependencies` in `package.json`.

- [ ] **Step 2: Import the color scales and toggle dark mode**

Edit `src/main.ts`. Add these imports at the very top (before the existing imports):

```typescript
import "@radix-ui/colors/slate.css";
import "@radix-ui/colors/slate-dark.css";
import "@radix-ui/colors/indigo.css";
import "@radix-ui/colors/indigo-dark.css";
import "@radix-ui/colors/red.css";
import "@radix-ui/colors/red-dark.css";
```

Add this block right after the imports (the dark CSS scales are scoped to `.dark`, so toggle that class to follow the OS theme):

```typescript
// Radix dark color scales live under `.dark`; mirror the OS preference onto <html>.
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);
```

- [ ] **Step 3: Rewrite `style.css` with Radix tokens**

Replace the entire contents of `src/style.css`:

```css
:root {
  --bg: var(--slate-1);
  --panel: var(--slate-2);
  --text: var(--slate-12);
  --muted: var(--slate-11);
  --border: var(--slate-6);
  --border-strong: var(--slate-8);
  --accent: var(--indigo-9);
  --accent-hover: var(--indigo-10);
  --accent-contrast: white;
  --focus: var(--indigo-8);
  --error: var(--red-11);
  --radius: 10px;
  font-family: system-ui, sans-serif;
  color-scheme: light dark;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 2rem 1rem;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

#app {
  max-width: 720px;
  margin-inline: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.75rem;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.06);
}

h1 {
  margin: 0 0 0.75rem;
  font-size: 1.6rem;
  letter-spacing: -0.02em;
}

.note {
  font-size: 0.85rem;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.6rem 0.8rem;
  margin: 0 0 1.5rem;
}

.drops {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.drop {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius);
  padding: 1.25rem;
  text-align: center;
  font-size: 0.95rem;
  color: var(--muted);
  cursor: pointer;
  transition: border-color 120ms, background 120ms, color 120ms;
}

.drop:hover {
  border-color: var(--accent);
  color: var(--text);
}

.drop.filled {
  border-style: solid;
  border-color: var(--accent);
  color: var(--text);
}

#preview {
  margin: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

#preview img {
  border-radius: var(--radius);
  max-width: 100%;
}

#preview audio {
  width: 100%;
}

.controls {
  margin: 1.5rem 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  color: var(--muted);
  max-width: 260px;
}

select {
  appearance: none;
  font-size: 0.95rem;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
}

.hint {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--muted);
}

button {
  font-size: 1rem;
  font-weight: 500;
  padding: 0.65rem 1.3rem;
  border: none;
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--accent-contrast);
  cursor: pointer;
  transition: background 120ms;
}

button:hover:not(:disabled) {
  background: var(--accent-hover);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

progress {
  width: 100%;
  height: 8px;
  margin-top: 1rem;
  border: none;
  border-radius: 999px;
  overflow: hidden;
}

progress::-webkit-progress-bar {
  background: var(--border);
  border-radius: 999px;
}

progress::-webkit-progress-value {
  background: var(--accent);
  border-radius: 999px;
}

progress::-moz-progress-bar {
  background: var(--accent);
}

#status {
  margin-top: 0.75rem;
  font-size: 0.9rem;
  color: var(--muted);
}

#download {
  margin-top: 0.75rem;
}

#download a {
  color: var(--accent);
  font-weight: 500;
}

.error {
  color: var(--error);
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 0.8rem;
}
```

- [ ] **Step 4: Build + visual verification**

Run: `pnpm build`
Expected: PASS — Vite resolves the `@radix-ui/colors` CSS imports and bundles them; no errors.

Run: `pnpm dev`, open in Chrome.
Expected:
- Centered card panel; indigo primary button with hover; dashed drop zones that turn solid/indigo when filled and on hover.
- The visualizer `<select>` is styled to match.
- Toggling the OS light/dark theme flips the whole palette (Radix slate/indigo dark scales).
- Generating still works and an error still renders red/monospace.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/style.css src/main.ts
git commit -m "feat: Radix-color UI refresh with auto dark mode"
```

---

## Self-Review

**Spec coverage:**
- Radix look, no React → Task 3 (`@radix-ui/colors`, restyle, dark mode). ✓
- Visualizer baked via ffmpeg filter_complex → Task 1 (builders) + Task 2 (wiring + smoke). ✓
- Dropdown with off/bars/waveform/spectrum, default none → Task 2 markup + Task 1 default param. ✓
- asplit pattern (song still plays) → Task 1 `buildVizComplex`. ✓
- Both static & animated paths → Task 1 both builders, Task 2 smoke covers both. ✓
- Preview shows image+audio only, caption about export → Task 2 `.hint` copy. ✓
- Filter strings validated by spike, not guessed → Task 2 Step 4 with per-filter fallbacks. ✓
- Risk/fallback for missing core filters → Task 2 Step 4. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete. ✓

**Type consistency:** `VizStyle` defined in Task 1, imported in `encode.ts` and `main.ts` (Task 2); `buildVizComplex`/`buildStaticArgs`/`buildAnimatedArgs` signatures match across tasks; `visualizer` field name consistent in types, `buildInput`, and both return objects. ✓
