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
