import { type VizStyle, type VizLayout, DEFAULT_VIZ_LAYOUT } from "./encode-args";
import { drawBars, drawWave } from "./viz-draw";

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

    if (style === "bars") {
      analyser.getByteFrequencyData(data);
      drawBars(c, w, h, data);
    } else {
      analyser.getByteTimeDomainData(data);
      drawWave(c, w, h, data);
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
    if (rect.width === 0 || rect.height === 0) return; // guard: avoid NaN deltas
    const dx = (e.clientX - startX) / rect.width;
    const dy = (e.clientY - startY) / rect.height;
    if (mode === "move") {
      // clamp the top-left so the whole box stays in frame (no sliders to recover it)
      layout = {
        ...startLayout,
        x: clamp(startLayout.x + dx, 0, 1 - startLayout.w),
        y: clamp(startLayout.y + dy, 0, 1 - startLayout.h),
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
