import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIZ_LAYOUT,
  DEFAULT_WM_LAYOUT,
  buildAnimatedArgs,
  buildConcatList,
  buildStaticArgs,
  centerBounds,
  computeRepeatCount,
  targetDims,
  rotatedSize,
  screenToLocal,
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
  it("is the bottom full-width quarter strip, unrotated", () => {
    expect(DEFAULT_VIZ_LAYOUT).toEqual({ x: 0, y: 0.75, w: 1, h: 0.25, rot: 0 });
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
  it("anchors bottom-left at ~4.5% of image height, unrotated", () => {
    expect(DEFAULT_WM_LAYOUT).toEqual({ x: 0.03, y: 0.92, size: 0.045, rot: 0 });
  });
});

describe("rotatedSize", () => {
  it("returns the input size at 0°", () => {
    expect(rotatedSize(200, 100, 0)).toEqual({ w: 200, h: 100 });
  });
  it("swaps width and height at 90°", () => {
    const { w, h } = rotatedSize(200, 100, 90);
    expect(w).toBeCloseTo(100);
    expect(h).toBeCloseTo(200);
  });
  it("expands to the bounding box of the rotated rect at 45°", () => {
    const { w, h } = rotatedSize(200, 100, 45);
    expect(w).toBeCloseTo((200 + 100) / Math.SQRT2);
    expect(h).toBeCloseTo((200 + 100) / Math.SQRT2);
  });
});

describe("screenToLocal", () => {
  it("is the identity at 0°", () => {
    expect(screenToLocal(10, -4, 0)).toEqual({ x: 10, y: -4 });
  });
  it("maps screen-down to local-width for a box rotated 90° clockwise", () => {
    const { x, y } = screenToLocal(0, 10, 90);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(0);
  });
  it("maps screen-right to local-minus-height at 90°", () => {
    const { x, y } = screenToLocal(10, 0, 90);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-10);
  });
  it("maps a drag along the rotated diagonal to pure width growth at 45°", () => {
    const { x, y } = screenToLocal(10, 10, 45);
    expect(x).toBeCloseTo(Math.hypot(10, 10));
    expect(y).toBeCloseTo(0);
  });
  it("inverts the drag direction at 180°", () => {
    const { x, y } = screenToLocal(10, 6, 180);
    expect(x).toBeCloseTo(-10);
    expect(y).toBeCloseTo(-6);
  });
});

describe("centerBounds", () => {
  // host 640×360; viz default strip is 640×90 px
  it("matches the unrotated clamp at 0°", () => {
    const b = centerBounds(320, 90, 0, 640, 360);
    expect(b.minX).toBeCloseTo(0.25); // half of the 320px box
    expect(b.maxX).toBeCloseTo(0.75);
    expect(b.minY).toBeCloseTo(0.125);
    expect(b.maxY).toBeCloseTo(0.875);
  });
  it("swaps the travel range at 90° — a full-width strip can slide sideways", () => {
    const b = centerBounds(640, 90, 90, 640, 360);
    // visually 90px wide now → nearly the full horizontal range
    expect(b.minX).toBeCloseTo(45 / 640);
    expect(b.maxX).toBeCloseTo(1 - 45 / 640);
    // but 640px tall > 360px frame → vertically pinned to the center
    expect(b.minY).toBe(0.5);
    expect(b.maxY).toBe(0.5);
  });
  it("pins a full-width strip horizontally at 0° (nothing to slide)", () => {
    const b = centerBounds(640, 90, 0, 640, 360);
    expect(b.minX).toBe(0.5);
    expect(b.maxX).toBe(0.5);
  });
});

describe("rotation in the filtergraph", () => {
  it("rotates the viz stream before overlaying (alpha-preserving)", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", {
      x: 10, y: 200, fps: 30, durationSec: 3, rot: 90,
    });
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];" +
        "[1:v]rotate=1.570796:ow=rotw(1.570796):oh=roth(1.570796):c=none[vr];" +
        "[bg][vr]overlay=x=10:y=200:shortest=1[vout]",
    );
  });
  it("rotates the watermark stream before overlaying", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", undefined, {
      x: 20, y: 400, durationSec: 42, rot: -30,
    });
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];" +
        "[1:v]rotate=-0.523599:ow=rotw(-0.523599):oh=roth(-0.523599):c=none[wr];" +
        "[bg][wr]overlay=x=20:y=400[vout]",
    );
  });
  it("rotates both independently in the chained graph", () => {
    const args = buildAnimatedArgs(
      "audio.mp3", "out.mp4",
      { x: 0, y: 5, fps: 30, durationSec: 12, rot: 45 },
      { x: 8, y: 16, durationSec: 42, rot: 15 },
    );
    expect(args).toContain(
      "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[bg];" +
        "[1:v]rotate=0.785398:ow=rotw(0.785398):oh=roth(0.785398):c=none[vr];" +
        "[bg][vr]overlay=x=0:y=5:shortest=1[v1];" +
        "[2:v]rotate=0.261799:ow=rotw(0.261799):oh=roth(0.261799):c=none[wr];" +
        "[v1][wr]overlay=x=8:y=16[vout]",
    );
  });
  it("emits no rotate node at 0°", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", {
      x: 10, y: 200, fps: 30, durationSec: 3, rot: 0,
    });
    expect(args.join(" ")).not.toContain("rotate");
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

describe("targetDims", () => {
  it("even-rounds the source for 'original' without scaling", () => {
    expect(targetDims(1001, 601, "original")).toEqual({ w: 1000, h: 600 });
  });
  it("downscales to fit the 1080p box, keeping aspect", () => {
    expect(targetDims(3840, 2160, "1080p")).toEqual({ w: 1920, h: 1080 });
  });
  it("upscales a smaller source to fill the preset box", () => {
    expect(targetDims(640, 360, "1080p")).toEqual({ w: 1920, h: 1080 });
  });
  it("upscales to fit the box, not past it", () => {
    // 800x556 → limited by height: 1080/556 ≈ 1.9424 → 1553x1080 → even 1552x1080
    expect(targetDims(800, 556, "1080p")).toEqual({ w: 1552, h: 1080 });
  });
  it("fits a panorama by width, not just height", () => {
    expect(targetDims(4000, 1000, "1080p")).toEqual({ w: 1920, h: 480 });
  });
  it("fits a portrait by height and even-rounds the width", () => {
    expect(targetDims(1080, 1920, "720p")).toEqual({ w: 404, h: 720 });
  });
});

describe("output resolution in args", () => {
  it("uses exact scale dims in buildStaticArgs without overlays", () => {
    const args = buildStaticArgs("image.png", "audio.mp3", "out.mp4", undefined, undefined, { w: 1280, h: 720 });
    expect(args).toContain("scale=1280:720");
    expect(args).not.toContain("scale=trunc(iw/2)*2:trunc(ih/2)*2");
  });
  it("uses exact scale dims in the overlay graph", () => {
    const args = buildStaticArgs(
      "image.png", "audio.mp3", "out.mp4",
      { x: 10, y: 200, fps: 15, durationSec: 3 },
      undefined,
      { w: 1920, h: 1080 },
    );
    expect(args).toContain(
      "[0:v]scale=1920:1080[bg];[bg][1:v]overlay=x=10:y=200:shortest=1[vout]",
    );
  });
  it("uses exact scale dims in buildAnimatedArgs", () => {
    const args = buildAnimatedArgs("audio.mp3", "out.mp4", undefined, undefined, { w: 852, h: 480 });
    expect(args).toContain("scale=852:480");
  });
});
