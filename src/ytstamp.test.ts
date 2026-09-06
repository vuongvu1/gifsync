import { describe, expect, it } from "vitest";
import { asWatchUrl, formatOffset, parseDebugInfo, timestampUrl } from "./ytstamp";

// Trimmed to the fields the parser reads, plus noise it must ignore.
const SAMPLE = JSON.stringify({
  ns: "yt",
  cmt: "4441.456",
  live: "dvr",
  docid: "Gf05bSlqS1M",
  vct: "4441.456",
  lio: "1787349005.07",
  lat: 20.375118255615234,
  debug_videoId: "Gf05bSlqS1M",
  timestamp: 1787353466775,
});

describe("parseDebugInfo", () => {
  it("reads the video id and playhead position", () => {
    const info = parseDebugInfo(SAMPLE);
    expect(info.videoId).toBe("Gf05bSlqS1M");
    expect(info.seconds).toBeCloseTo(4441.456);
    expect(info.live).toBe(true);
  });

  it("derives the wall clock of the marked moment from lio + cmt", () => {
    // lio is the epoch second of media time 0, so lio + cmt is when it happened.
    const info = parseDebugInfo(SAMPLE);
    expect(info.markedAt?.getTime()).toBe(Math.round((1787349005.07 + 4441.456) * 1000));
  });

  it("falls back to debug_videoId, vct, and timestamp", () => {
    const info = parseDebugInfo(JSON.stringify({ debug_videoId: "abc123", vct: "90.5", timestamp: 1787353466775 }));
    expect(info.videoId).toBe("abc123");
    expect(info.seconds).toBeCloseTo(90.5);
    expect(info.live).toBe(false);
    expect(info.markedAt?.getTime()).toBe(1787353466775);
  });

  it("recovers fields from text that isn't valid JSON", () => {
    // Copying from the player context menu often picks up stray characters.
    const info = parseDebugInfo(`Debug info: {"docid": "xyz789", "cmt": "12.25",`);
    expect(info.videoId).toBe("xyz789");
    expect(info.seconds).toBeCloseTo(12.25);
  });

  it("rejects input with no video id", () => {
    expect(() => parseDebugInfo(JSON.stringify({ cmt: "10" }))).toThrow(/video id/i);
  });

  it("rejects input with no playhead position", () => {
    expect(() => parseDebugInfo(JSON.stringify({ docid: "abc" }))).toThrow(/timestamp/i);
  });

  it("rejects empty input", () => {
    expect(() => parseDebugInfo("   ")).toThrow(/paste/i);
  });
});

describe("asWatchUrl", () => {
  it("passes a pasted watch link through untouched, query string and all", () => {
    const url = "https://youtu.be/2loYnaV0Cx0?list=PLAB5UabKPmPLLfbvXHv4Kf-J0fa3aTHd9&t=2988";
    expect(asWatchUrl(`  ${url}\n`)).toBe(url);
  });

  it("ignores a debug blob, even one with a URL inside it", () => {
    expect(asWatchUrl('{ "docid": "abc", "url": "https://youtu.be/abc" }')).toBeNull();
  });

  it("rejects non-http schemes so the value is safe as an href", () => {
    expect(asWatchUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("timestampUrl", () => {
  it("truncates to whole seconds — YouTube's t= parameter has no sub-second precision", () => {
    expect(timestampUrl("Gf05bSlqS1M", 4441.456)).toBe("https://www.youtube.com/watch?v=Gf05bSlqS1M&t=4441s");
  });

  it("clamps a negative playhead at zero", () => {
    expect(timestampUrl("abc", -5)).toBe("https://www.youtube.com/watch?v=abc&t=0s");
  });
});

describe("formatOffset", () => {
  it("drops the hour segment below one hour", () => {
    expect(formatOffset(90.6)).toBe("1:30");
  });

  it("zero-pads minutes once hours are shown", () => {
    expect(formatOffset(4441.456)).toBe("1:14:01");
  });

  it("handles zero", () => {
    expect(formatOffset(0)).toBe("0:00");
  });
});
