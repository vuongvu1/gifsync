import type { TrackMeta } from "./track-label";

export type Track = TrackMeta & { path: string };
export type Pool = { gifs: string[]; tracks: Track[] };

// Served by the gifsync-pool Vite plugin, dev only. In a production build this
// 404s (or falls through to index.html and fails to parse) — either way the
// caller treats a rejection as "no pool" and hides the shuffle button.
export async function loadPool(): Promise<Pool> {
  const res = await fetch("/pool");
  if (!res.ok) throw new Error(`pool unavailable (${res.status})`);
  const pool = (await res.json()) as Pool;
  if (pool.gifs.length === 0 || pool.tracks.length === 0) throw new Error("pool is empty");
  return pool;
}

export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("cannot pick from an empty list");
  return items[Math.floor(Math.random() * items.length)];
}

// Vite serves any absolute path listed in server.fs.allow under /@fs, with the
// correct Content-Type. That type matters beyond cosmetics: buildInput()
// branches on File.type to choose the animated decode path.
export async function fetchAsFile(absPath: string): Promise<File> {
  const res = await fetch(`/@fs${absPath.split("/").map(encodeURIComponent).join("/")}`);
  const name = absPath.slice(absPath.lastIndexOf("/") + 1);
  if (!res.ok) throw new Error(`could not load ${name} (${res.status})`);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}
