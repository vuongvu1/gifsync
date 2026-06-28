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
