// Shared watermark rendering — identical in the live preview and the exported
// PNG, so what you see is what you get. Both run in the same browser, so the
// font resolves identically; sizes scale linearly with fontPx.

const FONT = (px: number) => `${px}px system-ui, sans-serif`;

export type WmMetrics = { pad: number; boxW: number; boxH: number };

// Padded box around the text: pad leaves room for the shadow blur so nothing
// clips at the canvas edge. (x, y) layout anchors are the text's top-left; the
// canvas/overlay sits at anchor − pad.
export function wmMetrics(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
): WmMetrics {
  ctx.font = FONT(fontPx);
  const pad = Math.ceil(fontPx * 0.25);
  return {
    pad,
    boxW: Math.ceil(ctx.measureText(text).width) + pad * 2,
    boxH: Math.ceil(fontPx * 1.2) + pad * 2,
  };
}

export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
  x: number,
  y: number,
): void {
  ctx.font = FONT(fontPx);
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = fontPx * 0.15;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}
