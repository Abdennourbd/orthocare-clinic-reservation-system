import { describe, expect, it } from "vitest";
import { buildBlobKey } from "./blobStorage";

describe("buildBlobKey", () => {
  it("builds a namespaced unique key, never from the user filename", () => {
    const a = buildBlobKey("cm123abc", ".pdf");
    const b = buildBlobKey("cm123abc", ".pdf");
    expect(a).toMatch(/^patients\/cm123abc\/[0-9a-f-]+\.pdf$/);
    expect(a).not.toBe(b);
  });

  it("rejects traversal and hostile patientIds", () => {
    for (const bad of ["../x", "a/b", "a b", "", "a..b", "é"]) {
      expect(() => buildBlobKey(bad, ".pdf")).toThrow();
    }
  });

  it("accepts every allow-listed extension", () => {
    for (const ext of [".jpg", ".jpeg", ".png", ".pdf", ".dcm"] as const) {
      expect(buildBlobKey("cm123abc", ext).endsWith(ext)).toBe(true);
    }
  });
});
