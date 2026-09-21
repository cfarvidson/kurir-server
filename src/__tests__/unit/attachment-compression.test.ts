/**
 * Unit tests for browser-side attachment compression.
 *
 * Covers:
 * - when a pick is compressed (file over 10 MB, mail over 25 MB) and when it
 *   is left alone
 * - how the mail's remaining bytes are shared between the images
 * - compressToFit() leaves fitting files alone, lowers quality before
 *   resolution, and steps resolution down when the quality floor is not enough
 */
import { describe, it, expect } from "vitest";
import {
  compressToFit,
  imageAllowance,
  MIN_QUALITY,
  needsCompression,
  type ImageOpener,
} from "@/lib/mail/attachment-compression";

const MB = 1024 * 1024;

function file(bytes: number, name = "photo.jpg", type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/**
 * A 4000 px image whose JPEG is `bytesAtBest` at full size and quality 0.9,
 * scaling with the pixel count and linearly with quality. Records each encode.
 */
function fakeOpener(bytesAtBest: number, log: [number | null, number][] = []) {
  const open: ImageOpener = async () => ({
    longestEdge: 4000,
    async encode(maxPixelSize, quality) {
      log.push([maxPixelSize, quality]);
      const scale = (maxPixelSize ?? 4000) / 4000;
      const bytes = bytesAtBest * scale * scale * (quality / 0.9);
      return new Blob([new Uint8Array(Math.round(bytes))]);
    },
    close() {},
  });
  return open;
}

describe("needsCompression", () => {
  it("leaves a pick that fits alone", () => {
    expect(needsCompression([file(8 * MB), file(3 * MB)], 10 * MB)).toBe(false);
  });

  it("compresses when an image is over the file limit", () => {
    expect(needsCompression([file(11 * MB), file(1 * MB)], 0)).toBe(true);
  });

  it("compresses when images would overfill the mail", () => {
    expect(needsCompression([file(4 * MB), file(4 * MB)], 20 * MB)).toBe(true);
  });

  it("leaves a pick alone when it holds no still image", () => {
    const picked = [
      file(11 * MB, "report.pdf", "application/pdf"),
      file(11 * MB, "clip.gif", "image/gif"),
    ];
    expect(needsCompression(picked, 24 * MB)).toBe(false);
  });
});

describe("imageAllowance", () => {
  it("lets small images keep their bytes and splits the rest", () => {
    expect(imageAllowance([6 * MB, 1 * MB, 7 * MB], 9 * MB)).toBe(4 * MB);
    expect(imageAllowance([2 * MB, 3 * MB], 9 * MB)).toBe(Infinity);
  });
});

describe("compressToFit", () => {
  it("touches only the image that is over its allowance", async () => {
    const small = file(1 * MB, "small.png", "image/png");
    const pdf = file(1 * MB, "report.pdf", "application/pdf");
    const large = file(12 * MB, "large.heic", "image/heic");

    const result = await compressToFit([small, pdf, large], 0, {
      open: fakeOpener(8 * MB),
    });

    expect(result[0]).toBe(small);
    expect(result[1]).toBe(pdf);
    expect(result[2].name).toBe("large.jpg");
    expect(result[2].type).toBe("image/jpeg");
    expect(result[2].size).toBe(8 * MB);
  });

  it("lowers quality before resolution", async () => {
    const log: [number | null, number][] = [];
    const [fitted] = await compressToFit([file(20 * MB)], 0, {
      open: fakeOpener(12 * MB, log),
    });

    expect(fitted.size).toBeLessThanOrEqual(10 * MB);
    expect(fitted.size).toBeGreaterThan(9 * MB);
    expect(log.every(([size]) => size === null)).toBe(true);
  });

  it("steps resolution down when the quality floor is not enough", async () => {
    const log: [number | null, number][] = [];
    const [fitted] = await compressToFit([file(40 * MB)], 0, {
      open: fakeOpener(24 * MB, log),
    });

    expect(fitted.size).toBeLessThanOrEqual(10 * MB);
    // Full size at the floor is 16 MB; 3024 px is the first step that fits.
    expect(log).toContainEqual([null, MIN_QUALITY]);
    expect(log.at(-1)?.[0]).toBe(3024);
  });
});
