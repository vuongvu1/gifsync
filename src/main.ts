import "@radix-ui/colors/slate.css";
import "@radix-ui/colors/slate-dark.css";
import "@radix-ui/colors/indigo.css";
import "@radix-ui/colors/indigo-dark.css";
import "@radix-ui/colors/red.css";
import "@radix-ui/colors/red-dark.css";

import { decodeAnimated } from "./decode";
import type { EncodeInput, WmInput } from "./encode";
import { encode } from "./encode";
import { getAudioDuration, renderPreview } from "./preview";
import { createPreviewViz } from "./preview-viz";
import { createPreviewWm } from "./preview-wm";
import {
  type Dims,
  type ResPreset,
  type VizStyle,
  type VizLayout,
  type WmLayout,
  DEFAULT_VIZ_LAYOUT,
  DEFAULT_WM_LAYOUT,
  rotatedSize,
  targetDims,
} from "./encode-args";
import { canvasToPng, renderVizFrames } from "./viz-frames";
import { drawWatermark, wmMetrics } from "./wm-draw";

// Radix dark color scales live under `.dark`; mirror the OS preference onto <html>.
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches);
applyTheme();
darkQuery.addEventListener("change", applyTheme);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <h1>gifsync</h1>
  <p class="note">
    Combine an image (photo, GIF, or animated WebP) with music into an MP4.
    Everything stays in your browser. <strong>Works best in Chrome / Edge</strong>
    (or Safari 17+). Firefox may not decode animated images.
  </p>
  <div class="drops">
    <label class="drop" id="imageDrop">
      Image (photo / GIF / WebP)
      <input id="imageInput" type="file" accept="image/*" hidden />
    </label>
    <label class="drop" id="audioDrop">
      Music
      <input id="audioInput" type="file" accept="audio/*" hidden />
    </label>
  </div>
  <div id="preview"><div id="imageHost"></div><audio id="audio" controls></audio></div>
  <div class="controls">
    <label class="field">
      Visualizer
      <select id="vizStyle">
        <option value="none">None</option>
        <option value="bars" selected>Frequency bars</option>
        <option value="waveform">Waveform</option>
      </select>
    </label>
    <label class="field">
      Watermark
      <input id="wmText" type="text" value="https://late-night-vibes.com" placeholder="Leave empty for none" />
    </label>
    <label class="field">
      Resolution
      <select id="resolution">
        <option value="original" selected>Original</option>
        <option value="1080p">1080p</option>
        <option value="720p">720p</option>
        <option value="480p">480p</option>
      </select>
    </label>
    <label class="field">
      <span>Visualizer rotation · <span id="vizRotVal">0°</span></span>
      <input id="vizRot" type="range" min="-180" max="180" step="1" value="0" />
    </label>
    <label class="field">
      <span>Watermark rotation · <span id="wmRotVal">0°</span></span>
      <input id="wmRot" type="range" min="-180" max="180" step="1" value="0" />
    </label>
    <p class="hint">Drag the visualizer or watermark to move it · drag the corner to resize. Both are rendered into the exported video.</p>
  </div>
  <button id="generate" disabled>Generate video</button>
  <progress id="progress" value="0" max="1" hidden></progress>
  <div id="status"></div>
  <div id="download"></div>
`;

const imageInput = app.querySelector<HTMLInputElement>("#imageInput")!;
const audioInput = app.querySelector<HTMLInputElement>("#audioInput")!;
const imageDrop = app.querySelector<HTMLLabelElement>("#imageDrop")!;
const audioDrop = app.querySelector<HTMLLabelElement>("#audioDrop")!;
const imageHost = app.querySelector<HTMLDivElement>("#imageHost")!;
const audioEl = app.querySelector<HTMLAudioElement>("#audio")!;
const vizSelect = app.querySelector<HTMLSelectElement>("#vizStyle")!;
const resSelect = app.querySelector<HTMLSelectElement>("#resolution")!;
const resOriginalOpt = resSelect.querySelector<HTMLOptionElement>('option[value="original"]')!;
const wmInput = app.querySelector<HTMLInputElement>("#wmText")!;
const vizRotInput = app.querySelector<HTMLInputElement>("#vizRot")!;
const vizRotVal = app.querySelector<HTMLSpanElement>("#vizRotVal")!;
const wmRotInput = app.querySelector<HTMLInputElement>("#wmRot")!;
const wmRotVal = app.querySelector<HTMLSpanElement>("#wmRotVal")!;
const generateBtn = app.querySelector<HTMLButtonElement>("#generate")!;
const progressEl = app.querySelector<HTMLProgressElement>("#progress")!;
const statusEl = app.querySelector<HTMLDivElement>("#status")!;
const downloadEl = app.querySelector<HTMLDivElement>("#download")!;

const previewViz = createPreviewViz(audioEl, (l) => {
  vizLayout = l;
});
const previewWm = createPreviewWm((l) => {
  wmLayout = l;
});

let imageFile: File | null = null;
let audioFile: File | null = null;
let lastDownloadUrl: string | null = null;
let vizLayout: VizLayout = { ...DEFAULT_VIZ_LAYOUT };
let wmLayout: WmLayout = { ...DEFAULT_WM_LAYOUT };

function refresh(): void {
  imageDrop.classList.toggle("filled", imageFile !== null);
  audioDrop.classList.toggle("filled", audioFile !== null);
  generateBtn.disabled = !(imageFile && audioFile);
  if (imageFile && audioFile) {
    renderPreview(imageFile, audioFile, imageHost, audioEl);
    const canvas = imageHost.querySelector<HTMLCanvasElement>("#vizCanvas");
    if (canvas) previewViz.attach(canvas);
    previewViz.setStyle(readVizStyle(vizSelect.value));
    previewViz.setLayout(vizLayout);
    const wmCanvas = imageHost.querySelector<HTMLCanvasElement>("#wmCanvas");
    if (wmCanvas) previewWm.attach(wmCanvas);
    previewWm.setLayout(wmLayout);
    previewWm.setText(wmInput.value);
  }
}

// Show the source height in the Original option (presets are named by height).
async function updateResLabel(): Promise<void> {
  if (!imageFile) {
    resOriginalOpt.textContent = "Original";
    return;
  }
  const bmp = await createImageBitmap(imageFile);
  resOriginalOpt.textContent = `Original (${bmp.height}px)`;
  bmp.close();
}

imageInput.addEventListener("change", () => {
  const f = imageInput.files?.[0] ?? null;
  if (f && !f.type.startsWith("image/")) {
    statusEl.textContent = "Please choose an image file (photo, GIF, or WebP).";
    statusEl.className = "error";
    imageInput.value = "";
    return;
  }
  imageFile = f;
  statusEl.textContent = "";
  statusEl.className = "";
  refresh();
  void updateResLabel();
});
audioInput.addEventListener("change", () => {
  const f = audioInput.files?.[0] ?? null;
  if (f && !f.type.startsWith("audio/")) {
    statusEl.textContent = "Please choose an audio file.";
    statusEl.className = "error";
    audioInput.value = "";
    return;
  }
  audioFile = f;
  statusEl.textContent = "";
  statusEl.className = "";
  refresh();
});

vizSelect.addEventListener("change", () => {
  previewViz.setStyle(readVizStyle(vizSelect.value));
});

wmInput.addEventListener("input", () => {
  previewWm.setText(wmInput.value);
});

vizRotInput.addEventListener("input", () => {
  vizLayout = { ...vizLayout, rot: Number(vizRotInput.value) };
  vizRotVal.textContent = `${vizLayout.rot}°`;
  previewViz.setLayout(vizLayout);
});

wmRotInput.addEventListener("input", () => {
  wmLayout = { ...wmLayout, rot: Number(wmRotInput.value) };
  wmRotVal.textContent = `${wmLayout.rot}°`;
  previewWm.setLayout(wmLayout);
});

function ext(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot) : "";
}

// Fail safe: if the <select> and VizStyle ever drift, fall back to "none"
// rather than feeding an unknown style into a malformed ffmpeg filtergraph.
const VIZ_STYLES: readonly VizStyle[] = ["none", "bars", "waveform"];
function readVizStyle(value: string): VizStyle {
  return (VIZ_STYLES as readonly string[]).includes(value) ? (value as VizStyle) : "none";
}

const RES_PRESETS: readonly ResPreset[] = ["original", "1080p", "720p", "480p"];
function readResPreset(value: string): ResPreset {
  return (RES_PRESETS as readonly string[]).includes(value) ? (value as ResPreset) : "original";
}

type VizData = { frames: Uint8Array[]; x: number; y: number; fps: number; rot: number } | null;

const VIZ_FPS = 30;

// Output dimensions the normalized layouts map onto: the source size (first
// frame for animated images) fitted to the selected resolution preset. Even
// (yuv420p) and exactly what ffmpeg scales to, so overlay coords line up.
async function outputDims(image: File): Promise<Dims> {
  const bmp = await createImageBitmap(image);
  const dims = targetDims(bmp.width, bmp.height, readResPreset(resSelect.value));
  bmp.close();
  return dims;
}

async function prepareViz(image: File, audio: File): Promise<VizData> {
  const style = readVizStyle(vizSelect.value);
  if (style === "none") return null;
  const { w: evenW, h: evenH } = await outputDims(image);
  const boxW = Math.max(1, Math.round(vizLayout.w * evenW));
  const boxH = Math.max(1, Math.round(vizLayout.h * evenH));
  const rot = vizLayout.rot % 360;
  let x = Math.round(vizLayout.x * evenW);
  let y = Math.round(vizLayout.y * evenH);
  if (rot) {
    // ffmpeg's rotate expands the frame to the rotated bbox; keep the box
    // center where the preview shows it (CSS rotates around the center too)
    const rs = rotatedSize(boxW, boxH, rot);
    x = Math.round((vizLayout.x + vizLayout.w / 2) * evenW - rs.w / 2);
    y = Math.round((vizLayout.y + vizLayout.h / 2) * evenH - rs.h / 2);
  }
  const frames = await renderVizFrames(audio, style, boxW, boxH, VIZ_FPS, (done, total) => {
    statusEl.textContent = `Rendering visualizer… ${done}/${total}`;
  });
  return { frames, x, y, fps: VIZ_FPS, rot };
}

// One transparent PNG at output resolution, same wm-draw code as the preview.
async function prepareWm(image: File, audio: File): Promise<WmInput | null> {
  const text = wmInput.value.trim();
  if (!text) return null;
  const { w: evenW, h: evenH } = await outputDims(image);
  const fontPx = Math.max(8, Math.round(wmLayout.size * evenH));
  const canvas = document.createElement("canvas");
  const c = canvas.getContext("2d");
  if (!c) throw new Error("Could not get a 2D canvas context for the watermark.");
  const m = wmMetrics(c, text, fontPx);
  canvas.width = m.boxW;
  canvas.height = m.boxH;
  drawWatermark(c, text, fontPx, m.pad, m.pad);
  const rot = wmLayout.rot % 360;
  let x = Math.round(wmLayout.x * evenW) - m.pad;
  let y = Math.round(wmLayout.y * evenH) - m.pad;
  if (rot) {
    // keep the rotated bbox centered on the unrotated box center (see prepareViz)
    const rs = rotatedSize(m.boxW, m.boxH, rot);
    x = Math.round(wmLayout.x * evenW - m.pad + m.boxW / 2 - rs.w / 2);
    y = Math.round(wmLayout.y * evenH - m.pad + m.boxH / 2 - rs.h / 2);
  }
  return {
    png: await canvasToPng(canvas),
    x,
    y,
    rot,
    durationSec: await getAudioDuration(audio),
  };
}

async function buildInput(
  image: File,
  audio: File,
  viz: VizData,
  wm: WmInput | null,
): Promise<EncodeInput> {
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const audioName = `audio${ext(audio)}`;
  const dims = await outputDims(image);
  const animatedType = image.type === "image/gif" || image.type === "image/webp";
  if (animatedType) {
    const frames = await decodeAnimated(image);
    if (frames.length > 1) {
      const audioDurationSec = await getAudioDuration(audio);
      return { kind: "animated", frames, audio: audioBytes, audioName, audioDurationSec, viz, wm, dims };
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
    wm,
    dims,
  };
}

generateBtn.addEventListener("click", async () => {
  if (!imageFile || !audioFile) return;

  // Reserve the save location NOW, while the click's user-activation is still
  // live. A programmatic link.click() after the (multi-second) encode is
  // blocked because transient activation has expired — that's why auto-download
  // wasn't working. Chromium-only; other browsers fall back to the link below.
  let fileHandle: FileSystemFileHandle | null = null;
  const picker = (window as { showSaveFilePicker?: Function }).showSaveFilePicker;
  if (picker) {
    try {
      fileHandle = await picker({
        suggestedName: "gifsync.mp4",
        types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled
      fileHandle = null; // picker unavailable/failed → fall back to link
    }
  }

  generateBtn.disabled = true;
  statusEl.textContent = "Decoding…";
  statusEl.className = "";
  downloadEl.replaceChildren();
  progressEl.hidden = false;
  progressEl.value = 0;

  try {
    const viz = await prepareViz(imageFile, audioFile);
    const wm = await prepareWm(imageFile, audioFile);
    statusEl.textContent = "Decoding…";
    const input = await buildInput(imageFile, audioFile, viz, wm);
    statusEl.textContent = "Encoding…";
    const blob = await encode(input, (ratio) => {
      progressEl.value = ratio;
    });
    if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
    lastDownloadUrl = URL.createObjectURL(blob);
    const url = lastDownloadUrl;
    const link = document.createElement("a");
    link.href = url;
    link.download = "gifsync.mp4";
    link.textContent = "Download MP4";
    downloadEl.append(link);

    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      statusEl.textContent = "Saved.";
    } else {
      link.click(); // best-effort auto-download (fast encodes only); link stays as fallback
      statusEl.textContent = "Done.";
    }
  } catch (err) {
    statusEl.className = "error";
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    progressEl.hidden = true;
    generateBtn.disabled = !(imageFile && audioFile);
  }
});
