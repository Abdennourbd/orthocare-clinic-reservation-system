import { describe, it, expect } from "vitest";
import { validateDocumentBytes, MAX_DOCUMENT_BYTES } from "./mime";
import { buildBlobKey } from "@/lib/documents/blobStorage";
import { documentUploadSchema } from "@/schemas/document";

// Task 15 step 2 — unit tests for the pure document-validation logic.
// Colocated with the module per CLAUDE.md ("unit tests live beside their
// module"). Nothing here touches Postgres or the Blob SDK: mime.ts,
// buildBlobKey and documentUploadSchema are all pure — the assertions below
// are the entire proof that a hostile upload cannot pass as a legitimate
// X-ray, so every "rejected" case checks the specific `reason`, not just
// `ok === false` (a check that only proves *some* branch fired, not the
// right one).

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function zeros(count: number): Uint8Array {
  return new Uint8Array(count);
}

// A real JPEG signature (FF D8 FF) followed by a JFIF marker and some
// filler — enough for hasMagicBytes to recognize it as a genuine image,
// not just three bytes chosen to satisfy the test.
const REAL_JPEG_BYTES = concatBytes(
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  textBytes("JFIF"),
  zeros(20),
);

const HTML_PAYLOAD_BYTES = textBytes("<script>alert(1)</script>");

const SVG_BYTES = textBytes(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

// DICOM's mandatory 128-byte preamble, then "DICM" at the correct offset.
const REAL_DICOM_BYTES = concatBytes(zeros(128), textBytes("DICM"), zeros(50));

// The same "DICM" marker, but at offset 0 instead of 128 — the format's
// preamble is exactly what a naive "does the file contain DICM anywhere"
// check would miss.
const DICOM_MARKER_AT_WRONG_OFFSET_BYTES = concatBytes(textBytes("DICM"), zeros(128));

describe("validateDocumentBytes", () => {
  it("accepts a real JPEG whose declared type, extension and bytes all agree", () => {
    const result = validateDocumentBytes({
      fileName: "radio.jpg",
      declaredMimeType: "image/jpeg",
      bytes: REAL_JPEG_BYTES,
    });

    expect(result).toEqual({
      ok: true,
      mimeType: "image/jpeg",
      extension: ".jpg",
    });
  });

  it("rejects the same JPEG bytes renamed to .png — EXTENSION_MISMATCH", () => {
    // Content and declared type are both genuinely JPEG here; only the file
    // name's extension lies. If the extension check were ever dropped or
    // reordered after the content check, this would come back CONTENT_MISMATCH
    // or even `ok: true` instead — so asserting the exact reason is what
    // makes this test able to catch that regression.
    const result = validateDocumentBytes({
      fileName: "radio.png",
      declaredMimeType: "image/jpeg",
      bytes: REAL_JPEG_BYTES,
    });

    expect(result).toEqual({ ok: false, reason: "EXTENSION_MISMATCH" });
  });

  it("rejects an HTML payload renamed to .jpg and declared image/jpeg — CONTENT_MISMATCH (stored XSS guard)", () => {
    // THIS IS THE STORED CROSS-SITE-SCRIPTING TEST. An attacker who can get
    // staff to upload (or who compromises the upload path with) an HTML file
    // wearing a .jpg extension and an image/jpeg Content-Type would, without
    // this byte-level check, have their script served *inline* from our own
    // origin the moment a staff member opens the "X-ray". The declared type
    // (image/jpeg) and the extension (.jpg) both lie convincingly here — only
    // reading the actual bytes catches it, which is why the reason must be
    // exactly CONTENT_MISMATCH and not TYPE or EXTENSION_MISMATCH: those
    // would mean the earlier, weaker checks accidentally caught it instead of
    // this one actually working.
    const result = validateDocumentBytes({
      fileName: "radio.jpg",
      declaredMimeType: "image/jpeg",
      bytes: HTML_PAYLOAD_BYTES,
    });

    expect(result).toEqual({ ok: false, reason: "CONTENT_MISMATCH" });
  });

  it("rejects an SVG — not in the allow-list, since an SVG can itself carry a script — TYPE", () => {
    const result = validateDocumentBytes({
      fileName: "radio.svg",
      declaredMimeType: "image/svg+xml",
      bytes: SVG_BYTES,
    });

    expect(result).toEqual({ ok: false, reason: "TYPE" });
  });

  it("accepts a DICOM file with DICM at the correct offset (128)", () => {
    const result = validateDocumentBytes({
      fileName: "radio.dcm",
      declaredMimeType: "application/dicom",
      bytes: REAL_DICOM_BYTES,
    });

    expect(result).toEqual({
      ok: true,
      mimeType: "application/dicom",
      extension: ".dcm",
    });
  });

  it("rejects a DICOM file with DICM at offset 0 instead of 128 — CONTENT_MISMATCH", () => {
    // The 128-byte preamble is DICOM's defining feature; a marker anywhere
    // else is not "close enough". Asserting CONTENT_MISMATCH (not `ok: true`
    // and not a different reason) is what would catch a regression where the
    // offset check was loosened to "DICM anywhere in the file".
    const result = validateDocumentBytes({
      fileName: "radio.dcm",
      declaredMimeType: "application/dicom",
      bytes: DICOM_MARKER_AT_WRONG_OFFSET_BYTES,
    });

    expect(result).toEqual({ ok: false, reason: "CONTENT_MISMATCH" });
  });

  it("rejects a PDF one byte over MAX_DOCUMENT_BYTES — SIZE", () => {
    // Imported, never hard-coded (task-15.md §Étape 2 — the cap has exactly
    // one declaration in the whole repo).
    const oversizedPdf = concatBytes(
      textBytes("%PDF-"),
      zeros(MAX_DOCUMENT_BYTES + 1 - 5),
    );
    expect(oversizedPdf.byteLength).toBe(MAX_DOCUMENT_BYTES + 1);

    const result = validateDocumentBytes({
      fileName: "radio.pdf",
      declaredMimeType: "application/pdf",
      bytes: oversizedPdf,
    });

    expect(result).toEqual({ ok: false, reason: "SIZE" });
  });

  it("accepts a PDF exactly at MAX_DOCUMENT_BYTES — the cap is inclusive, not exclusive", () => {
    const exactSizePdf = concatBytes(
      textBytes("%PDF-"),
      zeros(MAX_DOCUMENT_BYTES - 5),
    );
    expect(exactSizePdf.byteLength).toBe(MAX_DOCUMENT_BYTES);

    const result = validateDocumentBytes({
      fileName: "radio.pdf",
      declaredMimeType: "application/pdf",
      bytes: exactSizePdf,
    });

    expect(result).toEqual({
      ok: true,
      mimeType: "application/pdf",
      extension: ".pdf",
    });
  });
});

describe("documentUploadSchema", () => {
  it("rejects a path-traversal file name", () => {
    const result = documentUploadSchema.safeParse({
      name: "../../etc/passwd",
      declaredMimeType: "image/jpeg",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a file name containing CRLF (HTTP header injection guard)", () => {
    const result = documentUploadSchema.safeParse({
      name: "radio.jpg\r\nX-Injected: 1",
      declaredMimeType: "image/jpeg",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a file name longer than 255 characters", () => {
    // The bound matters concretely at step 4, where `name` is echoed into a
    // Content-Disposition response header — an unbounded name is itself an
    // injection surface, independent of the CRLF check above.
    const tooLong = `${"a".repeat(252)}.jpg`; // 256 characters
    expect(tooLong).toHaveLength(256);

    const result = documentUploadSchema.safeParse({
      name: tooLong,
      declaredMimeType: "image/jpeg",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a normal file name at or under the 255-character bound", () => {
    const result = documentUploadSchema.safeParse({
      name: "radio-panoramique-2026.jpg",
      declaredMimeType: "image/jpeg",
    });

    expect(result.success).toBe(true);
  });

  it('rejects a file name containing a double quote (Content-Disposition parameter-injection guard)', () => {
    // Regression test for ortho-security's step-2 audit BLOQUANT
    // (task-15.md §Étape 2): step 4 will echo `name` into
    // `Content-Disposition: attachment; filename="<name>"`. An unescaped `"`
    // closes that quoted parameter early, letting a second parameter —
    // including a `filename*` that takes priority over `filename` per
    // RFC 6266 §4.3 — be injected right after it. This name does not need to
    // be forged by staff: it can simply be the name of a file a patient
    // picked in their own browser's file selector (step 5).
    const result = documentUploadSchema.safeParse({
      name: 'rad"io.jpg',
      declaredMimeType: "image/jpeg",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a file name containing a semicolon (Content-Disposition parameter-injection guard)", () => {
    // Same header-injection surface as the double-quote case above: `;`
    // separates Content-Disposition parameters, so an unfiltered `;` lets an
    // uploaded file name declare a second parameter of its own.
    const result = documentUploadSchema.safeParse({
      name: "radio;x=1.jpg",
      declaredMimeType: "image/jpeg",
    });

    expect(result.success).toBe(false);
  });
});

describe("buildBlobKey", () => {
  it("never embeds the original file name — only patientId, a random id and the extension", () => {
    // buildBlobKey's signature deliberately takes no fileName parameter at
    // all (task-15.md §Décisions d'architecture 3: erasing a patient's name
    // from their record must not leave it surviving inside a blob path). The
    // strict format check below is what would fail if a future change ever
    // threaded a user-supplied name into the key instead of a random id.
    // No hyphen: a real Patient.id is a Prisma cuid (lower-case alphanumeric
    // only), and buildBlobKey now rejects anything that doesn't look like
    // one (see the "rejects a patientId that would escape the patients/
    // prefix" case below).
    const patientId = "patientcm2xyz123abc";
    const key = buildBlobKey(patientId, ".jpg");

    expect(key).toMatch(
      new RegExp(
        `^patients/${patientId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`,
        "i",
      ),
    );
  });

  it("produces a different key on every call — no collisions across uploads for the same patient", () => {
    const first = buildBlobKey("patient1", ".pdf");
    const second = buildBlobKey("patient1", ".pdf");

    expect(first).not.toBe(second);
  });

  it("rejects a patientId that would escape the patients/ prefix (path traversal guard)", () => {
    // Regression test for ortho-security's step-2 audit MAJEUR-3
    // (task-15.md §Étape 2): measured as `buildBlobKey("../../evil", ".jpg")`
    // → `patients/../../evil/<uuid>.jpg` before this guard existed. Not
    // reachable today (step 3 always resolves the patient row, and
    // therefore a genuine cuid, before calling buildBlobKey), but this
    // module is the safety boundary reused by steps 3-5 — it must fail
    // loudly rather than silently writing outside the patient's namespace,
    // where a future prefix-based scan or erasure would miss the blob.
    expect(() => buildBlobKey("../../evil", ".jpg")).toThrow();
  });
});
