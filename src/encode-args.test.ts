import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIZ_LAYOUT,
  DEFAULT_WM_LAYOUT,
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

describe("DEFAULT_VIZ_LAYOUT", () => {
  it("is the bottom full-width quarter strip", () => {
    expect(DEFAULT_VIZ_LAYOUT).toEqual({ x: 0, y: 0.75, w: 1, h: 0.25 });
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

describe("buildStaticArgs with a visualizer", () => {
  it("adds the viz PNG sequence input and overlays it", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", { x: 10, y: 200, fps: 15, durationSec: 3 });
    expect(args).toEqual(expect.arrayContaining(["-framerate", "15"]));
    expect(args).toContain("viz_%05d.png");
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];[bg][1:v]overlay=x=10:y=200:shortest=1[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "[vout]"]));
    expect(args).toEqual(expect.arrayContaining(["-map", "2:a"]));
    expect(args).toEqual(expect.arrayContaining(["-t", "3"])); // duration cap → guaranteed termination
    expect(args).not.toContain("-vf");
  });
  it("is unchanged when no visualizer (default)", () => {
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).toContain("-vf");
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).not.toContain("viz_%05d.png");
  });
});

describe("buildAnimatedArgs with a visualizer", () => {
  it("adds the viz PNG sequence input and overlays it", () => {
    const args = buildAnimatedArgs("audio.mp3", "out.mp4", { x: 0, y: 5, fps: 15, durationSec: 12 });
    expect(args).toEqual(expect.arrayContaining(["-framerate", "15"]));
    expect(args).toContain("viz_%05d.png");
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];[bg][1:v]overlay=x=0:y=5:shortest=1[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "2:a"]));
    expect(args).toEqual(expect.arrayContaining(["-t", "12"]));
    expect(args).not.toContain("-vf");
  });
  it("is unchanged when no visualizer (default)", () => {
    expect(buildAnimatedArgs("audio.mp3", "out.mp4")).toContain("-vf");
  });
});

describe("DEFAULT_WM_LAYOUT", () => {
  it("anchors bottom-left at ~4.5% of image height", () => {
    expect(DEFAULT_WM_LAYOUT).toEqual({ x: 0.03, y: 0.92, size: 0.045 });
  });
});

describe("buildStaticArgs with a watermark", () => {
  it("overlays the watermark PNG and caps duration at the audio length", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", undefined, {
      x: 20, y: 400, durationSec: 42,
    });
    expect(args).toContain("wm.png");
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];[bg][1:v]overlay=x=20:y=400[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "[vout]"]));
    expect(args).toEqual(expect.arrayContaining(["-map", "2:a"]));
    expect(args).toEqual(expect.arrayContaining(["-t", "42"])); // -loop 1 base is infinite
    expect(args).not.toContain("-vf");
    expect(args).not.toContain("viz_%05d.png");
  });
  it("chains viz then watermark overlays and caps at the viz duration", () => {
    const args = buildStaticArgs(
      "image.png", "audio.mp3", "out.mp4",
      { x: 10, y: 200, fps: 30, durationSec: 3 },
      { x: 20, y: 400, durationSec: 42 },
    );
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];" +
        "[bg][1:v]overlay=x=10:y=200:shortest=1[v1];" +
        "[v1][2:v]overlay=x=20:y=400[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "3:a"])); // audio shifts past both overlays
    expect(args).toEqual(expect.arrayContaining(["-t", "3"]));
  });
});

describe("buildAnimatedArgs with a watermark", () => {
  it("overlays the watermark without a duration cap (concat video is finite)", () => {
    const args = buildAnimatedArgs("audio.mp3", "out.mp4", undefined, {
      x: 8, y: 16, durationSec: 42,
    });
    expect(args).toContain("wm.png");
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];[bg][1:v]overlay=x=8:y=16[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "2:a"]));
    expect(args).not.toContain("-t");
  });
  it("chains viz then watermark with the audio mapped past both", () => {
    const args = buildAnimatedArgs(
      "audio.mp3", "out.mp4",
      { x: 0, y: 5, fps: 30, durationSec: 12 },
      { x: 8, y: 16, durationSec: 42 },
    );
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];" +
        "[bg][1:v]overlay=x=0:y=5:shortest=1[v1];" +
        "[v1][2:v]overlay=x=8:y=16[vout]",
    );
    expect(args).toEqual(expect.arrayContaining(["-map", "3:a"]));
    expect(args).toEqual(expect.arrayContaining(["-t", "12"]));
  });
});
