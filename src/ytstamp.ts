// Turns the JSON blob from YouTube's player "Copy debug info" into a watch URL
// pointing at the exact moment the blob was copied. Useful on a live stream:
// there is no shareable timestamp while the stream runs, but the DVR/archive
// keeps the same media clock, so the offset stays valid afterwards.

export type StampInfo = {
  videoId: string;
  /** Playhead position in seconds, measured from the start of the stream. */
  seconds: number;
  live: boolean;
  /** Wall clock of the marked moment, when the blob carries enough to derive it. */
  markedAt: Date | null;
};

// Fields we read, in preference order. `cmt`/`vct` are the playhead in seconds;
// `docid`/`debug_videoId` are the video id; `lio` is the epoch second of media
// time 0, so `lio + cmt` is when the marked frame actually aired (the raw
// `timestamp` is when the blob was copied, which lags by the live latency).
const ID_KEYS = ["docid", "debug_videoId"] as const;
const TIME_KEYS = ["cmt", "vct", "lct"] as const;

type Blob = Record<string, unknown>;

export function parseDebugInfo(text: string): StampInfo {
  if (!text.trim()) throw new Error("Paste the player's debug info first.");

  const blob = parseBlob(text);
  const videoId = firstString(blob, ID_KEYS);
  if (!videoId) {
    throw new Error("No video id in that text — copy the whole debug info block from the player menu.");
  }
  const seconds = firstNumber(blob, TIME_KEYS);
  if (seconds === null) {
    throw new Error("No playback timestamp in that text — copy the whole debug info block from the player menu.");
  }

  const lio = num(blob["lio"]);
  const copiedAt = num(blob["timestamp"]);
  const markedAt =
    lio !== null
      ? new Date(Math.round((lio + seconds) * 1000))
      : copiedAt !== null
        ? new Date(copiedAt)
        : null;

  return { videoId, seconds, live: str(blob["live"]) !== null, markedAt };
}

// A pasted watch link is already the answer — a `?t=` URL carries its own
// offset, so there is nothing to derive. Anchored at the start so it never
// matches a URL sitting inside a debug blob, and http(s)-only so the value is
// safe to use as an href.
export function asWatchUrl(text: string): string | null {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

export function timestampUrl(videoId: string, seconds: number): string {
  const at = Math.max(0, Math.floor(seconds));
  return `https://www.youtube.com/watch?v=${videoId}&t=${at}s`;
}

export function formatOffset(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// The blob is valid JSON when copied cleanly, but a stray character or a
// truncated selection is common enough that a per-key regex fallback beats
// making the user re-copy.
function parseBlob(text: string): Blob {
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1));
      if (parsed && typeof parsed === "object") return parsed as Blob;
    } catch {
      // fall through to the loose scan
    }
  }
  const keys = [...ID_KEYS, ...TIME_KEYS, "lio", "timestamp", "live"];
  const blob: Blob = {};
  for (const key of keys) {
    const match = new RegExp(`"${key}"\\s*:\\s*"?([^",}\\s]+)"?`).exec(text);
    if (match) blob[key] = match[1];
  }
  return blob;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstString(blob: Blob, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = str(blob[key]);
    if (value) return value;
  }
  return null;
}

function firstNumber(blob: Blob, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = num(blob[key]);
    if (value !== null) return value;
  }
  return null;
}
