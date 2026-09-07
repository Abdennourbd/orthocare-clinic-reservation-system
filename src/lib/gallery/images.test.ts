import { describe, it, expect } from "vitest";
import {
  validateCaseImageBytes,
  MAX_CASE_IMAGE_BYTES,
} from "./images";

// G2 — byte-level validation for public case-gallery uploads (JPEG/PNG/WebP).
// Same discipline as documents/mime.ts: declared type, extension and magic
// bytes must all agree; messages stay generic (no file names in errors).

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00,
]);

describe("validateCaseImageBytes", () => {
  it("accepts a genuine JPEG/PNG/WebP when everything agrees", () => {
    expect(
      validateCaseImageBytes({ fileName: "avant.jpg", declaredMimeType: "image/jpeg", bytes: jpeg }),
    ).toMatchObject({ ok: true, mimeType: "image/jpeg", extension: ".jpg" });
    expect(
      validateCaseImageBytes({ fileName: "apres.png", declaredMimeType: "image/png", bytes: png }),
    ).toMatchObject({ ok: true, mimeType: "image/png" });
    expect(
      validateCaseImageBytes({ fileName: "cas.webp", declaredMimeType: "image/webp", bytes: webp }),
    ).toMatchObject({ ok: true, mimeType: "image/webp" });
  });

  it("rejects a non-allow-listed type (SVG, PDF…)", () => {
    expect(
      validateCaseImageBytes({ fileName: "x.svg", declaredMimeType: "image/svg+xml", bytes: jpeg }),
    ).toEqual({ ok: false, reason: "TYPE" });
    expect(
      validateCaseImageBytes({ fileName: "x.pdf", declaredMimeType: "application/pdf", bytes: jpeg }),
    ).toEqual({ ok: false, reason: "TYPE" });
  });

  it("rejects an HTML payload renamed to .jpg (content mismatch)", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    expect(
      validateCaseImageBytes({ fileName: "evil.jpg", declaredMimeType: "image/jpeg", bytes: html }),
    ).toEqual({ ok: false, reason: "CONTENT_MISMATCH" });
  });

  it("rejects extension/type disagreement", () => {
    expect(
      validateCaseImageBytes({ fileName: "photo.png", declaredMimeType: "image/jpeg", bytes: jpeg }),
    ).toEqual({ ok: false, reason: "EXTENSION_MISMATCH" });
  });

  it("rejects oversized files", () => {
    const big = new Uint8Array(MAX_CASE_IMAGE_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(
      validateCaseImageBytes({ fileName: "big.jpg", declaredMimeType: "image/jpeg", bytes: big }),
    ).toEqual({ ok: false, reason: "SIZE" });
  });
});
