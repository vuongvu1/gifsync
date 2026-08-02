import { describe, expect, it } from "vitest";
import { formatTrack, trackMeta } from "./track-label";

describe("trackMeta", () => {
  it("prefers embedded tags over the filename", () => {
    expect(trackMeta("whatever-123.mp3", { title: "Night Drive", artist: "Kaz" })).toEqual({
      title: "Night Drive",
      artist: "Kaz",
    });
  });

  it("splits a 'Title — Artist.mp3' filename when tags are empty", () => {
    expect(trackMeta("Night Drive — Kaz.mp3", {})).toEqual({
      title: "Night Drive",
      artist: "Kaz",
    });
  });

  it("de-slugs a raw pixabay filename and reports no artist", () => {
    expect(trackMeta("relaxing-piano-music-248868.mp3", {})).toEqual({
      title: "Relaxing Piano Music",
    });
  });

  it("keeps a tag artist while falling back to the filename for the title", () => {
    expect(trackMeta("lofi-beat-99.mp3", { artist: "Kaz" })).toEqual({
      title: "Lofi Beat",
      artist: "Kaz",
    });
  });

  it("ignores whitespace-only tags", () => {
    expect(trackMeta("chill-vibes.mp3", { title: "  ", artist: "" })).toEqual({
      title: "Chill Vibes",
    });
  });

  it("handles underscores and a filename with no separators", () => {
    expect(trackMeta("deep_focus_loop.wav", {})).toEqual({ title: "Deep Focus Loop" });
    expect(trackMeta("track.mp3", {})).toEqual({ title: "Track" });
  });
});

describe("formatTrack", () => {
  it("joins title and artist with an em dash", () => {
    expect(formatTrack({ title: "Night Drive", artist: "Kaz" })).toBe("Night Drive — Kaz");
  });

  it("returns the title alone when there is no artist", () => {
    expect(formatTrack({ title: "Night Drive" })).toBe("Night Drive");
  });
});
