import { describe, expect, it } from "vitest";
import { buildCaseImageKey, blobKeyFromUrl } from "./blobStorage";

describe("buildCaseImageKey", () => {
  it("builds a namespaced unique key, never from the user filename", () => {
    const a = buildCaseImageKey(".jpg");
    const b = buildCaseImageKey(".jpg");
    expect(a).toMatch(/^cases\/[0-9a-f-]+\.jpg$/);
    expect(a).not.toBe(b);
  });

  it("accepts every allow-listed extension", () => {
    for (const ext of [".jpg", ".jpeg", ".png", ".webp"] as const) {
      expect(buildCaseImageKey(ext).endsWith(ext)).toBe(true);
    }
  });
});

describe("blobKeyFromUrl", () => {
  const suffix = "public.blob.vercel-storage.com";

  it("extracts the key from one of our blob URLs", () => {
    expect(
      blobKeyFromUrl("https://abc123.public.blob.vercel-storage.com/cases/uuid.jpg", suffix),
    ).toBe("cases/uuid.jpg");
  });

  it("returns null for local paths, foreign hosts and non-case paths", () => {
    expect(blobKeyFromUrl("/images/smile.jpg", suffix)).toBeNull();
    expect(blobKeyFromUrl("https://evil.test/cases/uuid.jpg", suffix)).toBeNull();
    expect(blobKeyFromUrl("https://abc.public.blob.vercel-storage.com/other/uuid.jpg", suffix)).toBeNull();
    expect(blobKeyFromUrl("not a url", suffix)).toBeNull();
  });
});
