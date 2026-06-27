# Visualizer Drag/Resize + Transparent Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the visualizer background transparent (export + preview) and replace the x/y/w/h sliders with dragging the box to move it and a bottom-right corner handle to resize it.

**Architecture:** Export drops the dark band by keying the filter's black background to alpha (`colorkey`) before overlay. The preview canvas becomes transparent (bars/line only) with a subtle 1px outline + corner handle as an editing guide, and gains pointer drag/resize that reports layout via an `onLayoutChange` callback. The `VizLayout {x,y,w,h}` model is unchanged.

**Tech Stack:** TypeScript, Vite, ffmpeg.wasm, Pointer Events, Canvas, Vitest. No new dependencies.

## Global Constraints

- No new dependencies. No React.
- `VizLayout`/`DEFAULT_VIZ_LAYOUT` unchanged.
- Export transparency suffix (validated against native ffmpeg, use verbatim): the visualizer filter is followed by `,format=rgba,colorkey=0x000000:0.30:0.10` before overlay.
- Preview is transparent (no band fill). A 1px outline `rgba(255,255,255,0.35)` + a 12px handle `rgba(255,255,255,0.9)` at the bottom-right are preview-only editing aids — never baked into the export.
- Resize: bottom-right corner handle only (top-left anchored); drag the body to move. `w`/`h` clamp `[0.05, 1]`; `x`/`y` clamp `[0, 1]`.
- Sliders are removed entirely.
- Toolchain: pnpm; Node 18+ (`node -v`; if < 18 `nvm use`). Tests: `pnpm test`. Build: `pnpm build`.

---

### Task 1: Transparent export (colorkey)

Append the alpha-keying suffix in `buildVizComplex`. Pure function — TDD.

**Files:**
- Modify: `src/encode-args.ts`
- Test: `src/encode-args.test.ts`

**Interfaces:**
- `buildVizComplex(style, layout?)` signature unchanged; emitted string now keys black to transparent.

- [ ] **Step 1: Update the tests**

In `src/encode-args.test.ts`, add a colorkey assertion to BOTH `buildVizComplex` tests. The default-layout test becomes:

```typescript
  it("uses the default layout (bottom, full width, quarter height)", () => {
    const c = buildVizComplex("bars");
    expect(c).toContain("[1:a]asplit=2[aud][avis]");
    expect(c).toContain("showfreqs=mode=bar:ascale=log:colors=gray");
    expect(c).toContain("format=rgba,colorkey=0x000000:0.30:0.10");
    expect(c).toContain("scale2ref=w=main_w*1:h=main_h*0.25[viz][bg2]");
    expect(c).toContain("overlay=x=W*0:y=H*0.75[vout]");
  });
```

And the custom-layout test gains one line:

```typescript
  it("maps a custom layout into scale2ref size and overlay position", () => {
    const c = buildVizComplex("waveform", { x: 0.1, y: 0.2, w: 0.5, h: 0.25 });
    expect(c).toContain("showwaves=mode=line:colors=gray");
    expect(c).toContain("format=rgba,colorkey=0x000000:0.30:0.10");
    expect(c).toContain("scale2ref=w=main_w*0.5:h=main_h*0.25[viz][bg2]");
    expect(c).toContain("overlay=x=W*0.1:y=H*0.2[vout]");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- encode-args`
Expected: FAIL — the `colorkey` substring is not yet emitted.

- [ ] **Step 3: Implement the suffix in `encode-args.ts`**

In `buildVizComplex`, change the visualizer-filter line to append the alpha key (everything else in the function stays):

```typescript
    `[avis]${VIZ_FILTERS[style]},format=rgba,colorkey=0x000000:0.30:0.10[viz0]`,
```

(So the full array entry that was `` `[avis]${VIZ_FILTERS[style]}[viz0]` `` now includes `,format=rgba,colorkey=0x000000:0.30:0.10` before `[viz0]`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- encode-args`
Expected: PASS — all encode-args tests green.

- [ ] **Step 5: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/encode-args.ts src/encode-args.test.ts
git commit -m "feat: transparent visualizer background (colorkey black to alpha)"
```

---

### Task 2: Transparent preview + drag/resize

Rewrite `preview-viz.ts` to render transparent (outline+handle, no band) and handle pointer drag/resize via an `onLayoutChange` callback; remove the sliders in `main.ts`; update CSS.

**Files:**
- Modify (full replace): `src/preview-viz.ts`
- Modify: `src/main.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `VizStyle`, `VizLayout`, `DEFAULT_VIZ_LAYOUT` from `./encode-args`.
- Produces: `createPreviewViz(audioEl: HTMLAudioElement, onLayoutChange: (layout: VizLayout) => void)` returning `{ attach(canvas), setLayout(layout), setStyle(style) }`.

- [ ] **Step 1: Replace `src/preview-viz.ts` entirely**

```typescript
import { type VizStyle, type VizLayout, DEFAULT_VIZ_LAYOUT } from "./encode-args";

const HANDLE = 16; // bottom-right resize hit zone (px)

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Live, audio-synced approximation of the exported visualizer. Web Audio's
// AnalyserNode feeds a TRANSPARENT canvas overlaid on the preview image; the box
// can be dragged to move and resized from its bottom-right corner. A 1px outline
// + corner handle are preview-only editing aids and are never baked into the
// export. This is a preview, not a byte-match of ffmpeg's output — FFT differs.
export function createPreviewViz(
  audioEl: HTMLAudioElement,
  onLayoutChange: (layout: VizLayout) => void,
): {
  attach(canvas: HTMLCanvasElement): void;
  setLayout(layout: VizLayout): void;
  setStyle(style: VizStyle): void;
} {
  let canvas: HTMLCanvasElement | null = null;
  let style: VizStyle = "none";
  let layout: VizLayout = DEFAULT_VIZ_LAYOUT;
  let rafId = 0;

  // Audio graph is created lazily on first play (AudioContext needs a gesture).
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  // Uint8Array<ArrayBuffer> (not ArrayBufferLike) so getByte*Data accepts it without a cast.
  let data: Uint8Array<ArrayBuffer> | null = null;

  // drag state
  let mode: "move" | "resize" | null = null;
  let startX = 0;
  let startY = 0;
  let startLayout: VizLayout = DEFAULT_VIZ_LAYOUT;

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

  function applyLayout(): void {
    if (!canvas) return;
    canvas.style.left = `${layout.x * 100}%`;
    canvas.style.top = `${layout.y * 100}%`;
    canvas.style.width = `${layout.w * 100}%`;
    canvas.style.height = `${layout.h * 100}%`;
    canvas.style.pointerEvents = style === "none" ? "none" : "auto";
  }

  // Transparent: no background fill. Outline + handle mark the editable box;
  // when live, the reactive bars/line draw over the image.
  function render(live: boolean): void {
    if (!canvas || style === "none") {
      clear();
      return;
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const c = canvas.getContext("2d");
    if (!c) return;

    c.clearRect(0, 0, w, h);

    // editing guide (preview only): 1px outline + bottom-right resize handle
    c.strokeStyle = "rgba(255,255,255,0.35)";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, w - 1, h - 1);
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.fillRect(w - 12, h - 12, 12, 12);

    if (!live || !analyser || !data) return; // paused: outline + handle only
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

  function tick(): void {
    rafId = requestAnimationFrame(tick);
    render(true);
  }

  // Redraw when not playing so drag/style changes update the box immediately.
  function renderStatic(): void {
    if (audioEl.paused) render(false);
  }

  function start(): void {
    ensureAudio();
    if (ctx && ctx.state === "suspended") void ctx.resume();
    if (!rafId) tick();
  }
  function stop(): void {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    render(false); // keep the outline/handle visible while paused
  }

  function overHandle(e: PointerEvent): boolean {
    if (!canvas) return false;
    return e.offsetX >= canvas.clientWidth - HANDLE && e.offsetY >= canvas.clientHeight - HANDLE;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!canvas || style === "none") return;
    mode = overHandle(e) ? "resize" : "move";
    startX = e.clientX;
    startY = e.clientY;
    startLayout = layout;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!canvas) return;
    if (!mode) {
      canvas.style.cursor = overHandle(e) ? "nwse-resize" : "move";
      return;
    }
    const host = canvas.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const dx = (e.clientX - startX) / rect.width;
    const dy = (e.clientY - startY) / rect.height;
    if (mode === "move") {
      layout = {
        ...startLayout,
        x: clamp(startLayout.x + dx, 0, 1),
        y: clamp(startLayout.y + dy, 0, 1),
      };
    } else {
      layout = {
        ...startLayout,
        w: clamp(startLayout.w + dx, 0.05, 1),
        h: clamp(startLayout.h + dy, 0.05, 1),
      };
    }
    applyLayout();
    renderStatic();
    onLayoutChange(layout);
  }

  function onPointerUp(e: PointerEvent): void {
    if (canvas && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    mode = null;
  }

  audioEl.addEventListener("play", start);
  audioEl.addEventListener("pause", stop);
  audioEl.addEventListener("ended", stop);

  return {
    attach(c: HTMLCanvasElement): void {
      canvas = c;
      c.addEventListener("pointerdown", onPointerDown);
      c.addEventListener("pointermove", onPointerMove);
      c.addEventListener("pointerup", onPointerUp);
      c.addEventListener("pointercancel", onPointerUp);
      applyLayout();
      renderStatic();
    },
    setLayout(l: VizLayout): void {
      layout = l;
      applyLayout();
      renderStatic();
    },
    setStyle(s: VizStyle): void {
      style = s;
      applyLayout(); // toggles pointer-events for the none case
      renderStatic();
    },
  };
}
```

- [ ] **Step 2: Remove the sliders + pass the callback in `main.ts`**

(a) In the `app.innerHTML` template, replace the entire `.controls` block with one that drops the `.sliders` div and updates the hint:

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
    <p class="hint">Drag the visualizer to move it · drag the corner to resize. It's rendered into the exported video.</p>
  </div>
```

(b) Delete the eight slider element queries (the `vizX`, `vizY`, `vizW`, `vizH`, `vizXval`, `vizYval`, `vizWval`, `vizHval` consts).

(c) Delete the `updateVizLayout` function and the `for (const el of [vizX, vizY, vizW, vizH]) { el.addEventListener("input", updateVizLayout); }` loop.

(d) Keep the `let vizLayout: VizLayout = { ...DEFAULT_VIZ_LAYOUT };` state. Change the `createPreviewViz` call to pass the sync callback:

```typescript
const previewViz = createPreviewViz(audioEl, (l) => {
  vizLayout = l;
});
```

(e) Leave `buildInput(...)` and the generate handler's `buildInput(imageFile, audioFile, readVizStyle(vizSelect.value), vizLayout)` call unchanged. Leave `refresh()` unchanged (it already does `attach` → `setStyle` → `setLayout(vizLayout)`).

- [ ] **Step 3: Update `src/style.css`**

(a) Delete the `.sliders` and `.slider` rule blocks (no longer used).

(b) Update the `#vizCanvas` rule so it's transparent-friendly and touch-draggable (position only; size/place/pointer-events are set inline by JS):

```css
#vizCanvas {
  position: absolute;
  touch-action: none;
}
```

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS — tsc clean (the `onLayoutChange` arg is required and supplied; pointer handlers are typed).

- [ ] **Step 5: Manual browser smoke**

Run: `pnpm dev`, open in Chrome.
1. Drop a static image + audio. Pick **Frequency bars** (do not play yet).
   Expected: a thin outline + a small bottom-right handle mark the box; NO dark band fill; the image shows through.
2. Drag the box body → it moves; drag the bottom-right handle → it resizes (corner cursor shows on hover).
3. Press play → gray bars animate over the image with no dark band behind them.
4. Set **None** → outline/handle/bars disappear and the area is click-through.
5. Console clean throughout.

(Export transparency was re-validated natively — bars overlay the image with no black band.)

- [ ] **Step 6: Commit**

```bash
git add src/preview-viz.ts src/main.ts src/style.css
git commit -m "feat: drag/resize the visualizer on the preview; transparent background"
```

---

## Self-Review

**Spec coverage:**
- Export transparency via colorkey suffix → Task 1. ✓
- Preview transparent (no band), outline + handle guide → Task 2 Step 1 `render`. ✓
- Drag body to move, bottom-right handle to resize, clamps → Task 2 Step 1 pointer handlers. ✓
- `pointer-events` auto/none by style; `touch-action:none` → Task 2 Step 1 `applyLayout` + Step 3 CSS. ✓
- `onLayoutChange` callback keeps export `vizLayout` synced → Task 2 Step 1 signature + Step 2(d). ✓
- Sliders removed (markup, queries, fn, listeners) → Task 2 Step 2 + Step 3 CSS. ✓
- Hint text updated → Task 2 Step 2(a). ✓
- colorkey test → Task 1 Step 1. ✓

**Placeholder scan:** None. Full code given (entire preview-viz.ts; exact edits elsewhere).

**Type consistency:** `createPreviewViz(audioEl, onLayoutChange)` two-arg signature matches between Task 2 Step 1 (definition) and Step 2(d) (call). Return shape `{attach,setLayout,setStyle}` unchanged, so `refresh()` calls still valid. `VizLayout` used consistently. `#vizCanvas` id consistent across preview.ts (creator, unchanged), preview-viz (positioning), main.ts (query in refresh), style.css.

**Note:** `preview.ts` is unchanged — it still creates `<canvas id="vizCanvas">`; the new pointer listeners attach in `preview-viz.attach`, called from `refresh()` after each render.
