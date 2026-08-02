export type TrackMeta = { title: string; artist?: string };

const SEP = " — "; // em dash, both the display format and the filename convention

// Pixabay strips ID3 tags from its downloads, so the filename is usually the
// only source. Two shapes show up: "Title — Artist.mp3" (renamed by hand) and
// "some-slug-248868.mp3" (raw download, trailing digits are pixabay's id).
function fromFilename(filename: string): TrackMeta {
  const stem = filename.replace(/\.[^.]+$/, "");
  const at = stem.indexOf(SEP);
  if (at >= 0) {
    const title = stem.slice(0, at).trim();
    const artist = stem.slice(at + SEP.length).trim();
    if (title && artist) return { title, artist };
  }
  const words = stem.replace(/-\d+$/, "").split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return { title: stem };
  return { title: words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") };
}

export function trackMeta(
  filename: string,
  tags: { title?: string; artist?: string },
): TrackMeta {
  const fallback = fromFilename(filename);
  const title = tags.title?.trim() || fallback.title;
  const artist = tags.artist?.trim() || fallback.artist;
  return artist ? { title, artist } : { title };
}

export function formatTrack(meta: TrackMeta): string {
  return meta.artist ? `${meta.title}${SEP}${meta.artist}` : meta.title;
}
