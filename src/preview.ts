let lastImageUrl: string | null = null;
let lastAudioUrl: string | null = null;

export function renderPreview(
  image: Blob,
  audio: Blob,
  imageHost: HTMLElement,
  audioEl: HTMLAudioElement,
): void {
  if (lastImageUrl) URL.revokeObjectURL(lastImageUrl);
  if (lastAudioUrl) URL.revokeObjectURL(lastAudioUrl);

  lastImageUrl = URL.createObjectURL(image);
  lastAudioUrl = URL.createObjectURL(audio);

  imageHost.replaceChildren();
  const img = document.createElement("img");
  img.src = lastImageUrl;
  img.alt = "preview";
  img.style.maxWidth = "100%";
  imageHost.append(img);

  audioEl.src = lastAudioUrl;
}

export function getAudioDuration(audio: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = new Audio();
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(el.duration);
    el.onerror = () => reject(new Error("Could not read audio metadata."));
    el.src = URL.createObjectURL(audio);
  });
}
