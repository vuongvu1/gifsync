import { type WmLayout, DEFAULT_WM_LAYOUT, screenToLocal } from "./encode-args";
import { drawWatermark, wmMetrics } from "./wm-draw";

const HANDLE = 14; // bottom-right resize hit zone (px)

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Draggable watermark box over the preview image, sized to its text. Drag to
// move; drag the bottom-right corner to change the font size. The 1px outline
// + corner handle are preview-only editing aids and are never baked into the
// export — the export re-renders the same text via wm-draw at image resolution.
export function createPreviewWm(onLayoutChange: (layout: WmLayout) => void): {
  attach(canvas: HTMLCanvasElement): void;
  setText(text: string): void;
  setLayout(layout: WmLayout): void;
} {
  let canvas: HTMLCanvasElement | null = null;
  let text = "";
  let layout: WmLayout = DEFAULT_WM_LAYOUT;
  let observer: ResizeObserver | null = null;

  // drag state
  let mode: "move" | "resize" | null = null;
  let startX = 0;
  let startY = 0;
  let startLayout: WmLayout = DEFAULT_WM_LAYOUT;

  function render(): void {
    if (!canvas) return;
    const host = canvas.parentElement;
    if (!host) return;
    const hw = host.clientWidth;
    const hh = host.clientHeight;
    if (!text.trim() || hw === 0 || hh === 0) {
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.pointerEvents = "none";
      return;
    }
    canvas.style.pointerEvents = "auto";
    const c = canvas.getContext("2d");
    if (!c) return;
    const fontPx = Math.max(6, layout.size * hh);
    const m = wmMetrics(c, text, fontPx);
    canvas.width = m.boxW; // also clears + resets ctx state
    canvas.height = m.boxH;
    canvas.style.left = `${layout.x * hw - m.pad}px`;
    canvas.style.top = `${layout.y * hh - m.pad}px`;
    // around the box center, like the export's rotate filter
    canvas.style.transform = layout.rot ? `rotate(${layout.rot}deg)` : "";

    drawWatermark(c, text, fontPx, m.pad, m.pad);

    // editing guide (preview only): 1px outline + bottom-right resize handle
    c.strokeStyle = "rgba(255,255,255,0.35)";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, m.boxW - 1, m.boxH - 1);
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.fillRect(m.boxW - 10, m.boxH - 10, 10, 10);
  }

  function overHandle(e: PointerEvent): boolean {
    if (!canvas) return false;
    return e.offsetX >= canvas.width - HANDLE && e.offsetY >= canvas.height - HANDLE;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!canvas || !text.trim()) return;
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
    if (mode === "move") {
      const dx = (e.clientX - startX) / rect.width;
      const dy = (e.clientY - startY) / rect.height;
      // ponytail: loose clamp — long text may hang past the right edge; both
      // preview (overflow:hidden) and export (overlay crop) cut it the same way.
      layout = {
        ...startLayout,
        x: clamp(startLayout.x + dx, 0, 0.98),
        y: clamp(startLayout.y + dy, 0, 0.96),
      };
    } else {
      // font grows along the box's local down-axis; rotate the pointer delta
      // into local space so the handle still resizes when the text is rotated
      const local = screenToLocal(e.clientX - startX, e.clientY - startY, startLayout.rot);
      layout = { ...startLayout, size: clamp(startLayout.size + local.y / rect.height, 0.015, 0.3) };
    }
    render();
    onLayoutChange(layout);
  }

  function onPointerUp(e: PointerEvent): void {
    if (canvas && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    mode = null;
  }

  return {
    attach(c: HTMLCanvasElement): void {
      canvas = c;
      c.addEventListener("pointerdown", onPointerDown);
      c.addEventListener("pointermove", onPointerMove);
      c.addEventListener("pointerup", onPointerUp);
      c.addEventListener("pointercancel", onPointerUp);
      // the preview <img> loads (and can resize) after attach — re-render then
      observer?.disconnect();
      observer = new ResizeObserver(render);
      if (c.parentElement) observer.observe(c.parentElement);
      render();
    },
    setText(t: string): void {
      text = t;
      render();
    },
    setLayout(l: WmLayout): void {
      layout = l;
      render();
    },
  };
}
