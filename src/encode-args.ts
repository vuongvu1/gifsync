const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export type VizStyle = "none" | "bars" | "waveform";

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
export function buildVizComplex(style: Exclude<VizStyle, "none">): string {
  return [
    "[1:a]asplit=2[aud][avis]",
    `[avis]${VIZ_FILTERS[style]}[viz0]`,
    `[0:v]${EVEN_SCALE}[bg]`,
    "[viz0][bg]scale2ref=w=main_w:h=main_h/4[viz][bg2]",
    "[bg2][viz]overlay=x=(W-w)/2:y=H-h[vout]",
  ].join(";");
}

export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
  style: VizStyle = "none",
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
    "-filter_complex", buildVizComplex(style),
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
    "-filter_complex", buildVizComplex(style),
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
