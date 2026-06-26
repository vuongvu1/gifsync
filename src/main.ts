import "@radix-ui/colors/slate.css";
import "@radix-ui/colors/slate-dark.css";
import "@radix-ui/colors/indigo.css";
import "@radix-ui/colors/indigo-dark.css";
import "@radix-ui/colors/red.css";
import "@radix-ui/colors/red-dark.css";

import { decodeAnimated } from "./decode";
import type { EncodeInput } from "./encode";
import { encode } from "./encode";
import { getAudioDuration, renderPreview } from "./preview";
import type { VizStyle } from "./encode-args";
import { createPreviewViz } from "./preview-viz";

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
        <option value="bars">Frequency bars</option>
        <option value="waveform">Waveform</option>
      </select>
    </label>
    <p class="hint">The visualizer is rendered into the exported video.</p>
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
const generateBtn = app.querySelector<HTMLButtonElement>("#generate")!;
const progressEl = app.querySelector<HTMLProgressElement>("#progress")!;
const statusEl = app.querySelector<HTMLDivElement>("#status")!;
const downloadEl = app.querySelector<HTMLDivElement>("#download")!;

const previewViz = createPreviewViz(audioEl);

let imageFile: File | null = null;
let audioFile: File | null = null;
let lastDownloadUrl: string | null = null;

function refresh(): void {
  imageDrop.classList.toggle("filled", imageFile !== null);
  audioDrop.classList.toggle("filled", audioFile !== null);
  generateBtn.disabled = !(imageFile && audioFile);
  if (imageFile && audioFile) {
    renderPreview(imageFile, audioFile, imageHost, audioEl);
    const canvas = imageHost.querySelector<HTMLCanvasElement>("#vizCanvas");
    if (canvas) previewViz.attach(canvas);
    previewViz.setStyle(readVizStyle(vizSelect.value));
  }
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
    const input = await buildInput(imageFile, audioFile, readVizStyle(vizSelect.value));
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
