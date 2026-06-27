const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export type VizStyle = "none" | "bars" | "waveform";

export type VizLayout = { x: number; y: number; w: number; h: number };

// Bottom strip, full width, quarter height — reproduces the original fixed overlay.
export const DEFAULT_VIZ_LAYOUT: VizLayout = { x: 0, y: 0.75, w: 1, h: 0.25 };

// Deterministic short decimal for ffmpeg expressions (avoids float noise like 0.30000000004).
function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

// Audio→video filter per style. Sizes don't matter here: scale2ref resizes
// the result to the image's width and a quarter of its height before overlay.
// Neutral gray, no color map.
const VIZ_FILTERS: Record<Exclude<VizStyle, "none">, string> = {
  bars: "showfreqs=mode=bar:ascale=log:colors=gray",
  waveform: "showwaves=mode=line:colors=gray",
};

// asplit keeps one audio copy for the output mux ([aud]) and feeds the other
// ([avis]) to the visualizer; the viz video is scaled to the image (main_w/
// main_h via scale2ref) and overlaid as a bottom strip.
export function buildVizComplex(
  style: Exclude<VizStyle, "none">,
  layout: VizLayout = DEFAULT_VIZ_LAYOUT,
): string {
  const x = fmt(layout.x), y = fmt(layout.y), w = fmt(layout.w), h = fmt(layout.h);
  // x/y are the box's TOP-LEFT corner (not centered): overlay places at W*x, H*y.
  // The default {x:0,w:1} happens to equal the old centered formula since w=full width.
  return [
    "[1:a]asplit=2[aud][avis]",
    `[avis]${VIZ_FILTERS[style]}[viz0]`,
    `[0:v]${EVEN_SCALE}[bg]`,
    `[viz0][bg]scale2ref=w=main_w*${w}:h=main_h*${h}[viz][bg2]`,
    `[bg2][viz]overlay=x=W*${x}:y=H*${y}[vout]`,
  ].join(";");
}

export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
  style: VizStyle = "none",
  layout: VizLayout = DEFAULT_VIZ_LAYOUT,
): string[] {
  if (style === "none") {
    return [
      "-loop", "1",
      "-i", imageName,
      "-i", audioName,
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-vf", EVEN_SCALE,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      out,
    ];
  }
  return [
    "-loop", "1",
    "-i", imageName,
    "-i", audioName,
    "-filter_complex", buildVizComplex(style, layout),
    "-map", "[vout]",
    "-map", "[aud]",
    "-tune", "stillimage",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  ];
}

export function buildAnimatedArgs(
  audioName: string,
  out: string,
  style: VizStyle = "none",
  layout: VizLayout = DEFAULT_VIZ_LAYOUT,
): string[] {
  if (style === "none") {
    return [
      "-f", "concat",
      "-safe", "0",
      "-i", "list.txt",
      "-i", audioName,
      "-pix_fmt", "yuv420p",
      "-vf", EVEN_SCALE,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      out,
    ];
  }
  return [
    "-f", "concat",
    "-safe", "0",
    "-i", "list.txt",
    "-i", audioName,
    "-filter_complex", buildVizComplex(style, layout),
    "-map", "[vout]",
    "-map", "[aud]",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  ];
}

export function computeRepeatCount(
  audioDurationSec: number,
  animDurationSec: number,
): number {
  if (animDurationSec <= 0) return 1;
  return Math.max(1, Math.ceil(audioDurationSec / animDurationSec));
}

// ffmpeg concat demuxer: the last entry's `duration` is ignored unless the
// final file is listed once more, so we re-list it at the end.
export function buildConcatList(
  frameNames: string[],
  frameDurationsSec: number[],
  repeats: number,
): string {
  const lines: string[] = [];
  for (let r = 0; r < repeats; r++) {
    for (let i = 0; i < frameNames.length; i++) {
      lines.push(`file '${frameNames[i]}'`);
      lines.push(`duration ${frameDurationsSec[i].toFixed(6)}`);
    }
  }
  lines.push(`file '${frameNames[frameNames.length - 1]}'`);
  return `${lines.join("\n")}\n`;
}
