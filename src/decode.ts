export type Frame = { png: Uint8Array; durationMs: number };

const DEFAULT_FRAME_MS = 100;

export async function decodeAnimated(file: Blob): Promise<Frame[]> {
  if (typeof ImageDecoder === "undefined") {
    throw new Error(
      "This browser cannot decode animated images. Use Chrome, Edge, or Safari 17+.",
    );
  }

  const buffer = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: buffer, type: file.type });
  await decoder.tracks.ready;

  const track = decoder.tracks.selectedTrack;
  if (!track) throw new Error("No decodable image track found.");
  const count = track.frameCount;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context.");

  const frames: Frame[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      canvas.width = image.displayWidth;
      canvas.height = image.displayHeight;
      ctx.drawImage(image, 0, 0);
      // VideoFrame.duration is in microseconds; some frames report null.
      const durationMs = image.duration ? image.duration / 1000 : DEFAULT_FRAME_MS;
      image.close();

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
          "image/png",
        );
      });
      frames.push({ png: new Uint8Array(await blob.arrayBuffer()), durationMs });
    }
  } finally {
    decoder.close();
  }
  return frames;
}
