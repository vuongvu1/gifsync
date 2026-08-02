import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAsFile, loadPool, pick } from "./shuffle";

afterEach(() => {
  vi.unstubAllGlobals();
});

// A fresh Response per call — a Response body can only be consumed once.
function stubFetch(handler: (url: string) => Response): void {
  vi.stubGlobal("fetch", (url: string) => Promise.resolve(handler(url)));
}

function body(type: string): Response {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": type } });
}

describe("fetchAsFile", () => {
  it("requests the path under /@fs and names the File after the basename", async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return body("image/gif");
    });

    const file = await fetchAsFile("/pool/gifs/vibe-001.gif");

    expect(seen).toEqual(["/@fs/pool/gifs/vibe-001.gif"]);
    expect(file.name).toBe("vibe-001.gif");
    expect(file.type).toBe("image/gif");
    expect(file.size).toBe(3);
  });

  it("carries the response content type through for webp and mp3", async () => {
    stubFetch(() => body("image/webp"));
    expect((await fetchAsFile("/a/vibe-008.webp")).type).toBe("image/webp");

    stubFetch(() => body("audio/mpeg"));
    expect((await fetchAsFile("/a/Night Drive — Kaz.mp3")).name).toBe("Night Drive — Kaz.mp3");
  });

  it("rejects on a non-ok response", async () => {
    stubFetch(() => new Response("nope", { status: 404 }));
    await expect(fetchAsFile("/a/missing.gif")).rejects.toThrow("missing.gif");
  });

  it("percent-encodes '#' so it isn't stripped as a URL fragment, but keeps the raw name", async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return body("audio/mpeg");
    });

    const file = await fetchAsFile("/music/Nocturne #2 — Kaz.mp3");

    expect(seen).toEqual(["/@fs/music/Nocturne%20%232%20%E2%80%94%20Kaz.mp3"]);
    expect(file.name).toBe("Nocturne #2 — Kaz.mp3");
  });
});

describe("loadPool", () => {
  it("returns the parsed pool", async () => {
    stubFetch(() =>
      Response.json({
        gifs: ["/g/a.gif"],
        tracks: [{ path: "/m/a.mp3", title: "A" }],
      }),
    );

    const pool = await loadPool();

    expect(pool.gifs).toEqual(["/g/a.gif"]);
    expect(pool.tracks).toEqual([{ path: "/m/a.mp3", title: "A" }]);
  });

  it("rejects when either list is empty, so the caller can hide the button", async () => {
    stubFetch(() => Response.json({ gifs: ["/g/a.gif"], tracks: [] }));
    await expect(loadPool()).rejects.toThrow("empty");

    stubFetch(() => Response.json({ gifs: [], tracks: [{ path: "/m/a.mp3", title: "A" }] }));
    await expect(loadPool()).rejects.toThrow("empty");
  });

  it("rejects when the endpoint is absent, as in a production build", async () => {
    stubFetch(() => new Response("", { status: 404 }));
    await expect(loadPool()).rejects.toThrow("404");
  });
});

describe("pick", () => {
  it("only ever returns a member of the list", () => {
    const items = ["a", "b", "c"];
    for (let i = 0; i < 200; i++) expect(items).toContain(pick(items));
  });

  it("can reach both ends of the list", () => {
    const items = ["a", "b", "c"];
    const seen = new Set(Array.from({ length: 200 }, () => pick(items)));
    expect(seen).toEqual(new Set(items));
  });

  it("throws on an empty list", () => {
    expect(() => pick([])).toThrow("empty");
  });
});
