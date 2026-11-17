import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_OUTPUT_QUALITY, parseOutputQuality, videoBitrate } from "./output-quality";

describe("output quality", () => {
  it("keeps saved choices and falls back on anything else", () => {
    expect(parseOutputQuality('{"frameRate":60,"height":720}')).toEqual({
      frameRate: 60,
      height: 720,
    });
    expect(parseOutputQuality('{"frameRate":59,"height":4320}')).toEqual(DEFAULT_OUTPUT_QUALITY);
    expect(parseOutputQuality(null)).toEqual(DEFAULT_OUTPUT_QUALITY);
    expect(parseOutputQuality("{nope")).toEqual(DEFAULT_OUTPUT_QUALITY);
  });

  it("spends more bits on more pixels and frames", () => {
    expect(videoBitrate({ frameRate: 30, height: 1080 })).toBe(6_000_000);
    expect(videoBitrate({ frameRate: 60, height: 1080 })).toBeGreaterThan(6_000_000);
    expect(videoBitrate({ frameRate: 30, height: 720 })).toBeLessThan(6_000_000);
  });
});
