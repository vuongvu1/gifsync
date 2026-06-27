import { type VizStyle, type VizLayout, DEFAULT_VIZ_LAYOUT } from "./encode-args";

// Live, audio-synced approximation of the exported visualizer. Web Audio's
// AnalyserNode feeds a canvas overlaid on the preview image. This is a preview,
// not a byte-match of ffmpeg's output — FFT params differ.
export function createPreviewViz(audioEl: HTMLAudioElement): {
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
}
