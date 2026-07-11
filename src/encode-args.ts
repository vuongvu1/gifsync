const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export type VizStyle = "none" | "bars" | "waveform";

export type VizLayout = { x: number; y: number; w: number; h: number };

// Bottom strip, full width, quarter height — the default box.
export const DEFAULT_VIZ_LAYOUT: VizLayout = { x: 0, y: 0.75, w: 1, h: 0.25 };

// Integer overlay coords (px), frame rate, and a duration cap (s) for the
// pre-rendered viz PNG sequence. The `-t` cap guarantees the encode terminates
// even though the base image uses an infinite `-loop 1` (older ffmpeg cores
// don't always stop an infinite input on `-shortest` alone). durationSec is the
// viz length (frames/fps ≥ audio), so `-shortest` still ends output at the audio.
export type VizArgs = { x: number; y: number; fps: number; durationSec: number };

// Normalized watermark layout: x/y anchor the text's top-left, size is the font
// height as a fraction of the image height.
export type WmLayout = { x: number; y: number; size: number };

export const DEFAULT_WM_LAYOUT: WmLayout = { x: 0.03, y: 0.92, size: 0.045 };

// Integer overlay coords (px) for the single watermark PNG, plus the audio
// duration — used as the `-t` cap when the watermark is the only overlay on an
// infinite `-loop 1` still image.
export type WmArgs = { x: number; y: number; durationSec: number };

export const WM_FILE = "wm.png";

// Overlay chain, left to right: base → viz (per-frame PNG sequence) → watermark
// (one static PNG; ffmpeg's default eof_action=repeat holds it for the whole
// video). Input indices shift with whichever overlays are present.
function overlayGraph(viz?: VizArgs, wm?: WmArgs): string {
  const steps = [`[0:v]${EVEN_SCALE}[bg]`];
  let cur = "bg";
  let idx = 1;
  if (viz) {
    const next = wm ? "v1" : "vout";
    steps.push(`[${cur}][${idx}:v]overlay=x=${viz.x}:y=${viz.y}:shortest=1[${next}]`);
    cur = next;
    idx += 1;
  }
  if (wm) {
    steps.push(`[${cur}][${idx}:v]overlay=x=${wm.x}:y=${wm.y}[vout]`);
  }
  return steps.join(";");
}

export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
  viz?: VizArgs,
  wm?: WmArgs,
): string[] {
  if (!viz && !wm) {
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
  const args = ["-loop", "1", "-i", imageName];
  if (viz) args.push("-framerate", String(viz.fps), "-i", "viz_%05d.png");
  if (wm) args.push("-i", WM_FILE);
  args.push("-i", audioName);
  const audioIdx = 1 + (viz ? 1 : 0) + (wm ? 1 : 0);
  args.push(
    "-filter_complex", overlayGraph(viz, wm),
    "-map", "[vout]",
    "-map", `${audioIdx}:a`,
    // Cap the infinite -loop 1 base: viz length when present, else audio length.
    "-t", String(viz ? viz.durationSec : wm!.durationSec),
    "-tune", "stillimage",
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  );
  return args;
}

export function buildAnimatedArgs(
  audioName: string,
  out: string,
  viz?: VizArgs,
  wm?: WmArgs,
): string[] {
  if (!viz && !wm) {
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
  const args = ["-f", "concat", "-safe", "0", "-i", "list.txt"];
  if (viz) args.push("-framerate", String(viz.fps), "-i", "viz_%05d.png");
  if (wm) args.push("-i", WM_FILE);
  args.push("-i", audioName);
  const audioIdx = 1 + (viz ? 1 : 0) + (wm ? 1 : 0);
  args.push("-filter_complex", overlayGraph(viz, wm), "-map", "[vout]", "-map", `${audioIdx}:a`);
  // The concat video is finite, so only the viz PNG stream needs a cap.
  if (viz) args.push("-t", String(viz.durationSec));
  args.push(
    "-pix_fmt", "yuv420p",
    "-c:v", "libx264",
    "-c:a", "aac",
    "-shortest",
    out,
  );
  return args;
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
