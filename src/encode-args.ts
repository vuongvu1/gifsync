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

const VIZ_OVERLAY = (x: number, y: number) =>
  `[0:v]${EVEN_SCALE}[bg];[bg][1:v]overlay=x=${x}:y=${y}:shortest=1[vout]`;

export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
  viz?: VizArgs,
): string[] {
  if (!viz) {
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
    "-framerate", String(viz.fps),
    "-i", "viz_%05d.png",
    "-i", audioName,
    "-filter_complex", VIZ_OVERLAY(viz.x, viz.y),
    "-map", "[vout]",
    "-map", "2:a",
    "-t", String(viz.durationSec),
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
  viz?: VizArgs,
): string[] {
  if (!viz) {
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
    "-framerate", String(viz.fps),
    "-i", "viz_%05d.png",
    "-i", audioName,
    "-filter_complex", VIZ_OVERLAY(viz.x, viz.y),
    "-map", "[vout]",
    "-map", "2:a",
    "-t", String(viz.durationSec),
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
