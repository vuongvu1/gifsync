import { decodeAnimated } from "./decode";
import type { EncodeInput } from "./encode";
import { encode } from "./encode";
import { getAudioDuration, renderPreview } from "./preview";

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
  <div id="preview"><audio id="audio" controls></audio></div>
  <button id="generate" disabled>Generate video</button>
  <progress id="progress" value="0" max="1" hidden></progress>
  <div id="status"></div>
  <div id="download"></div>
`;

const imageInput = app.querySelector<HTMLInputElement>("#imageInput")!;
const audioInput = app.querySelector<HTMLInputElement>("#audioInput")!;
const imageDrop = app.querySelector<HTMLLabelElement>("#imageDrop")!;
const audioDrop = app.querySelector<HTMLLabelElement>("#audioDrop")!;
const previewHost = app.querySelector<HTMLDivElement>("#preview")!;
const audioEl = app.querySelector<HTMLAudioElement>("#audio")!;
const generateBtn = app.querySelector<HTMLButtonElement>("#generate")!;
const progressEl = app.querySelector<HTMLProgressElement>("#progress")!;
const statusEl = app.querySelector<HTMLDivElement>("#status")!;
const downloadEl = app.querySelector<HTMLDivElement>("#download")!;

let imageFile: File | null = null;
let audioFile: File | null = null;

function refresh(): void {
  imageDrop.classList.toggle("filled", imageFile !== null);
  audioDrop.classList.toggle("filled", audioFile !== null);
  generateBtn.disabled = !(imageFile && audioFile);
  if (imageFile && audioFile) {
    renderPreview(imageFile, audioFile, previewHost, audioEl);
  }
}

imageInput.addEventListener("change", () => {
  imageFile = imageInput.files?.[0] ?? null;
  refresh();
});
audioInput.addEventListener("change", () => {
  audioFile = audioInput.files?.[0] ?? null;
  refresh();
});

function ext(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot) : "";
}

async function buildInput(image: File, audio: File): Promise<EncodeInput> {
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const audioName = `audio${ext(audio)}`;
  const animatedType = image.type === "image/gif" || image.type === "image/webp";
  if (animatedType) {
    const frames = await decodeAnimated(image);
    if (frames.length > 1) {
      const audioDurationSec = await getAudioDuration(audio);
      return { kind: "animated", frames, audio: audioBytes, audioName, audioDurationSec };
    }
  }
  const imageBytes = new Uint8Array(await image.arrayBuffer());
  return {
    kind: "static",
    image: imageBytes,
    imageName: `image${ext(image)}`,
    audio: audioBytes,
    audioName,
  };
}

generateBtn.addEventListener("click", async () => {
  if (!imageFile || !audioFile) return;
  generateBtn.disabled = true;
  statusEl.textContent = "Decoding…";
  statusEl.className = "";
  downloadEl.replaceChildren();
  progressEl.hidden = false;
  progressEl.value = 0;

  try {
    const input = await buildInput(imageFile, audioFile);
    statusEl.textContent = "Encoding…";
    const blob = await encode(input, (ratio) => {
      progressEl.value = ratio;
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gifsync.mp4";
    link.textContent = "Download MP4";
    downloadEl.append(link);
    statusEl.textContent = "Done.";
  } catch (err) {
    statusEl.className = "error";
    statusEl.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    progressEl.hidden = true;
    generateBtn.disabled = !(imageFile && audioFile);
  }
});
