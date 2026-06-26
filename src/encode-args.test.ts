import { describe, expect, it } from "vitest";
import {
  buildAnimatedArgs,
  buildConcatList,
  buildStaticArgs,
  buildVizComplex,
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

describe("buildVizComplex", () => {
  it("splits audio, runs the gray bars filter, and overlays at the bottom", () => {
    const c = buildVizComplex("bars");
    expect(c).toContain("[1:a]asplit=2[aud][avis]");
    expect(c).toContain("showfreqs=mode=bar:ascale=log:colors=gray");
    expect(c).toContain("scale2ref=w=main_w:h=main_h/4[viz][bg2]");
    expect(c).toContain("overlay=x=(W-w)/2:y=H-h[vout]");
  });
  it("uses the gray showwaves filter for the waveform style", () => {
    expect(buildVizComplex("waveform")).toContain("showwaves=mode=line:colors=gray");
  });
});

describe("buildStaticArgs with a visualizer", () => {
  it("emits filter_complex and maps the composited streams", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", "bars");
    expect(args).toContain("-filter_complex");
    expect(args).toContain(buildVizComplex("bars"));
    expect(args).toEqual(expect.arrayContaining(["-map", "[vout]"]));
    expect(args).toEqual(expect.arrayContaining(["-map", "[aud]"]));
    expect(args).not.toContain("-vf"); // filter_complex replaces -vf
  });
  it("is unchanged when style is none (default)", () => {
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).toEqual(
      buildStaticArgs("image.png", "audio.mp3", "out.mp4", "none"),
    );
    expect(buildStaticArgs("image.png", "audio.mp3", "out.mp4")).toContain("-vf");
  });
});

describe("buildAnimatedArgs with a visualizer", () => {
  it("emits filter_complex and maps the composited streams", () => {
    const args = buildAnimatedArgs("audio.mp3", "out.mp4", "waveform");
    expect(args).toContain("-filter_complex");
    expect(args).toContain(buildVizComplex("waveform"));
    expect(args).toEqual(expect.arrayContaining(["-map", "[vout]"]));
    expect(args).not.toContain("-vf");
  });
  it("is unchanged when style is none (default)", () => {
    expect(buildAnimatedArgs("audio.mp3", "out.mp4")).toContain("-vf");
  });
});
