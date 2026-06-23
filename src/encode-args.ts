const EVEN_SCALE = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export function buildStaticArgs(
  imageName: string,
  audioName: string,
  out: string,
): string[] {
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

export function buildAnimatedArgs(audioName: string, out: string): string[] {
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
