import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { Frame } from "./decode";
import type { VizStyle } from "./encode-args";
import {
  buildAnimatedArgs,
  buildConcatList,
  buildStaticArgs,
  computeRepeatCount,
} from "./encode-args";

export type StaticInput = {
  kind: "static";
  image: Uint8Array;
  imageName: string;
  audio: Uint8Array;
  audioName: string;
  visualizer: VizStyle;
};

export type AnimatedInput = {
  kind: "animated";
  frames: Frame[];
  audio: Uint8Array;
  audioName: string;
  audioDurationSec: number;
  visualizer: VizStyle;
};

export type EncodeInput = StaticInput | AnimatedInput;

const CORE_BASE =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/esm";

let instance: FFmpeg | null = null;
let stderrTail: string[] = [];
let activeProgress: (ratio: number) => void = () => {};

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  const ffmpeg = new FFmpeg();
  ffmpeg.on("log", ({ message }) => {
    stderrTail.push(message);
    if (stderrTail.length > 20) stderrTail.shift();
  });
  ffmpeg.on("progress", ({ progress }) => {
    activeProgress(Math.min(1, Math.max(0, progress)));
  });
  await ffmpeg.load({
    coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    workerURL: await toBlobURL(
      `${CORE_BASE}/ffmpeg-core.worker.js`,
      "text/javascript",
    ),
  });
  instance = ffmpeg;
  return ffmpeg;
}

export async function encode(
  input: EncodeInput,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  activeProgress = onProgress;
  const ffmpeg = await getFFmpeg();
  stderrTail = [];

  let args: string[];
  const fsFiles: string[] = [];

  if (input.kind === "static") {
    await ffmpeg.writeFile(input.imageName, input.image);
    fsFiles.push(input.imageName);
    await ffmpeg.writeFile(input.audioName, input.audio);
    fsFiles.push(input.audioName);
    args = buildStaticArgs(input.imageName, input.audioName, "out.mp4", input.visualizer);
  } else {
    const names = input.frames.map(
      (_, i) => `frame_${String(i).padStart(4, "0")}.png`,
    );
    for (let i = 0; i < input.frames.length; i++) {
      await ffmpeg.writeFile(names[i], input.frames[i].png);
      fsFiles.push(names[i]);
    }
    await ffmpeg.writeFile(input.audioName, input.audio);
    fsFiles.push(input.audioName);
    const durations = input.frames.map((f) => f.durationMs / 1000);
    const animDuration = durations.reduce((a, b) => a + b, 0);
    const repeats = computeRepeatCount(input.audioDurationSec, animDuration);
    const list = buildConcatList(names, durations, repeats);
    await ffmpeg.writeFile("list.txt", new TextEncoder().encode(list));
    fsFiles.push("list.txt");
    args = buildAnimatedArgs(input.audioName, "out.mp4", input.visualizer);
  }

  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) {
      throw new Error(`ffmpeg exited ${code}\n${stderrTail.join("\n")}`);
    }
    const data = await ffmpeg.readFile("out.mp4");
    const mp4: BlobPart = typeof data === "string" ? data : new Uint8Array(data);
    return new Blob([mp4], { type: "video/mp4" });
  } finally {
    for (const name of fsFiles) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
    try { await ffmpeg.deleteFile("out.mp4"); } catch {}
  }
}
