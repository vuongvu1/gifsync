import { describe, expect, it } from "vitest";
import { fft } from "./fft";

function mag(re: Float32Array, im: Float32Array, k: number): number {
  return Math.hypot(re[k], im[k]);
}

describe("fft", () => {
  it("throws when length is not a power of two", () => {
    expect(() => fft(new Float32Array(3), new Float32Array(3))).toThrow();
  });

  it("transforms a DC signal to a single bin-0 spike", () => {
    const re = new Float32Array([1, 1, 1, 1]);
    const im = new Float32Array(4);
    fft(re, im);
    expect(re[0]).toBeCloseTo(4, 5); // sum of samples
    expect(mag(re, im, 1)).toBeCloseTo(0, 5);
    expect(mag(re, im, 2)).toBeCloseTo(0, 5);
    expect(mag(re, im, 3)).toBeCloseTo(0, 5);
  });

  it("puts a pure cosine's energy at its frequency bin", () => {
    const n = 8;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 1 * i) / n); // bin 1
    fft(re, im);
    // cosine of bin k => peaks at k and n-k, each magnitude n/2
    expect(mag(re, im, 1)).toBeCloseTo(n / 2, 4);
    expect(mag(re, im, n - 1)).toBeCloseTo(n / 2, 4);
    expect(mag(re, im, 2)).toBeCloseTo(0, 4);
    expect(mag(re, im, 3)).toBeCloseTo(0, 4);
  });
});
