import { describe, expect, it } from "vitest";
import {
  buildAnimatedArgs,
  buildConcatList,
  buildStaticArgs,
  computeRepeatCount,
} from "./encode-args";

describe("buildStaticArgs", () => {
  it("loops one still image for the audio length", () => {
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).toEqual([
      "-loop", "1",
      "-i", "image.png",
      "-i", "audio.mp3",
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      "out.mp4",
    ]);
  });
});

describe("buildAnimatedArgs", () => {
  it("reads the concat list and muxes audio", () => {
    expect(buildAnimatedArgs("audio.mp3", "out.mp4")).toEqual([
      "-f", "concat",
      "-safe", "0",
      "-i", "list.txt",
      "-i", "audio.mp3",
      "-pix_fmt", "yuv420p",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      "out.mp4",
    ]);
  });
});

describe("computeRepeatCount", () => {
  it("rounds up so the loop fills the audio", () => {
    expect(computeRepeatCount(10, 3)).toBe(4);
  });
  it("returns 1 when the animation is already longer than the audio", () => {
    expect(computeRepeatCount(2, 5)).toBe(1);
  });
  it("never returns less than 1 for a zero-length animation", () => {
    expect(computeRepeatCount(10, 0)).toBe(1);
  });
});

describe("buildConcatList", () => {
  it("repeats every frame with its duration and re-lists the final frame", () => {
    const list = buildConcatList(["a.png", "b.png"], [0.04, 0.06], 2);
    expect(list).toBe(
      "file 'a.png'\n" +
        "duration 0.040000\n" +
        "file 'b.png'\n" +
        "duration 0.060000\n" +
        "file 'a.png'\n" +
        "duration 0.040000\n" +
        "file 'b.png'\n" +
        "duration 0.060000\n" +
        "file 'b.png'\n",
    );
  });
});
