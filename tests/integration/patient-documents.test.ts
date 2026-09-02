import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { AuditAction, AuditActorType, Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/mime";
import {
  POST as patientDocumentsPostRoute,
  GET as patientDocumentsGetRoute,
} from "@/app/api/admin/patients/[id]/documents/route";
import {
  GET as documentDownloadRoute,
  DELETE as documentDeleteRoute,
} from "@/app/api/admin/documents/[id]/route";

// The real SDK is never exercised in CI: the whole @vercel/blob module is
// mocked at its boundary, so the route runs its REAL code path —
// requireStaff -> formData -> size gate -> Zod -> byte validation ->
// buildBlobKey -> putDocument (real adapter, mocked SDK) -> DB -> audit.
// Mocking @vercel/blob (rather than src/lib/documents/blobStorage.ts) is
// what makes the `access: "private"` control directly assertable: the
// adapter's private-access contract lives in its call to the SDK's put().
vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));

import { put, get, del } from "@vercel/blob";

const mockedPut = vi.mocked(put);
const mockedGet = vi.mocked(get);
const mockedDel = vi.mocked(del);

// A real JPEG signature (FF D8 FF) followed by a JFIF marker and filler —
// the same fixture shape as src/lib/documents/mime.test.ts.
function realJpegBytes(totalLength: number): Uint8Array<ArrayBuffer> {
  const bytes = zeroBytes(totalLength);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
  bytes.set(new TextEncoder().encode("JFIF"), 6);
  return bytes;
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const bytes = zeroBytes(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

function zeroBytes(count: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(count));
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  // putDocument reads the token INSIDE the function; a stub keeps the test
  // independent of the developer's local .env (never read secrets here).
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-blob-token-for-vitest-only");
  mockedPut.mockReset();
  mockedPut.mockResolvedValue({} as Awaited<ReturnType<typeof put>>);
  mockedGet.mockReset();
  mockedDel.mockReset();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.RECEPTIONIST) {
  return getPrisma().user.create({
    data: {
      name: "Staff Test",
      email: `patient-documents-${Math.random().toString(36).slice(2)}@test.com`,
      passwordHash: "dummyhash",
      role,
      active: true,
    },
  });
}

async function cookieFor(user: { id: string; role: Role }) {
  const token = await createSessionToken({
    userId: user.id,
    role: user.role as "ADMIN" | "RECEPTIONIST",
    tokenVersion: 0,
  });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function createPatient() {
  return getPrisma().patient.create({
    data: {
      firstName: "Test",
      lastName: "Patient",
      phone: `05${Math.floor(10000000 + Math.random() * 89999999)}`,
      phoneE164: `+2135${Math.floor(1000000 + Math.random() * 8999999)}`,
    },
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

interface UploadOptions {
  name?: string;
  declaredMimeType?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  fileName?: string;
  omitFile?: boolean;
  omitName?: boolean;
  omitDeclaredMimeType?: boolean;
}

async function uploadRequest(
  patientId: string,
  cookie: string,
  options: UploadOptions = {},
) {
  const formData = new FormData();
  if (!options.omitFile) {
    const file = new File([options.bytes ?? realJpegBytes(64)], options.fileName ?? "radio.jpg", {
      type: options.declaredMimeType ?? "image/jpeg",
    });
    formData.append("file", file, options.fileName ?? "radio.jpg");
  }
  if (!options.omitName) {
    formData.append("name", options.name ?? "radio.jpg");
  }
  if (!options.omitDeclaredMimeType) {
    formData.append("declaredMimeType", options.declaredMimeType ?? "image/jpeg");
  }
  return patientDocumentsPostRoute(
    new NextRequest(`http://localhost:3000/api/admin/patients/${patientId}/documents`, {
      method: "POST",
      headers: { cookie },
      body: formData,
    }),
    ctx(patientId),
  );
}

async function listRequest(patientId: string, cookie: string) {
  return patientDocumentsGetRoute(
    new NextRequest(`http://localhost:3000/api/admin/patients/${patientId}/documents`, {
      headers: { cookie },
    }),
    ctx(patientId),
  );
}

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function downloadRequest(documentId: string, cookie: string) {
  return documentDownloadRoute(
    new NextRequest(`http://localhost:3000/api/admin/documents/${documentId}`, {
      headers: { cookie },
    }),
    ctx(documentId),
  );
}

async function deleteDocumentRequest(documentId: string, cookie: string) {
  return documentDeleteRoute(
    new NextRequest(`http://localhost:3000/api/admin/documents/${documentId}`, {
      method: "DELETE",
      headers: { cookie },
    }),
    ctx(documentId),
  );
}

async function lastAudit(action: AuditAction) {
  return getPrisma().auditLog.findFirst({
    where: { action },
    orderBy: { createdAt: "desc" },
  });
}

// Fixture rule (task15-handoff.md): every document in this file is created
// through the REAL POST route above — a direct patientDocument.create()
// would leave unspecified columns NULL and prove nothing. The one exception
// below is commented where it occurs.

describe("POST /api/admin/patients/[id]/documents", () => {
  it("uploads a real JPEG (201), stores the row, and answers with metadata only — never blobKey", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const bytes = realJpegBytes(1024);

    const response = await uploadRequest(patient.id, cookie, { bytes, name: "radio-panoramique.jpg" });
    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    // Exact whitelist — blobKey must not merely be absent by luck.
    expect(Object.keys(body).sort()).toEqual(
      ["id", "name", "mimeType", "sizeBytes", "uploadedAt"].sort(),
    );
    expect(body.name).toBe("radio-panoramique.jpg");
    expect(body.mimeType).toBe("image/jpeg");
    expect(body.sizeBytes).toBe(1024);

    const row = await getPrisma().patientDocument.findUniqueOrThrow({
      where: { id: body.id as string },
    });
    expect(row.patientId).toBe(patient.id);
    expect(row.name).toBe("radio-panoramique.jpg");
    expect(row.mimeType).toBe("image/jpeg");
    expect(row.sizeBytes).toBe(1024);
    expect(row.uploadedById).toBe(staff.id);
    // The key exists server-side only, derived from the patient id + a
    // random uuid — never from the uploaded name.
    expect(row.blobKey).toMatch(
      new RegExp(`^patients/${patient.id}/[0-9a-f-]{36}\\.jpg$`, "i"),
    );
    expect(row.blobKey).not.toContain("radio");
    expect(row.deletedAt).toBeNull();
  });

  it("AUDIT CONTROL: putDocument stores the blob with access \"private\"", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await uploadRequest(patient.id, cookie);
    expect(response.status).toBe(201);

    expect(mockedPut).toHaveBeenCalledTimes(1);
    const [blobKey, bytes, options] = mockedPut.mock.calls[0];
    // Non-negotiable (blobStorage.ts header comment): the SDK's default is
    // public — this assertion is what catches its reappearance.
    expect(options).toMatchObject({ access: "private", contentType: "image/jpeg" });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(String(blobKey)).toMatch(/^patients\/[a-z0-9]+\//i);
  });

  it("audits PATIENT_DOCUMENT_UPLOADED with ids and size only — never the file name, never the blobKey", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await uploadRequest(patient.id, cookie, { name: "dentaire-secret.jpg" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };

    const audit = await lastAudit(AuditAction.PATIENT_DOCUMENT_UPLOADED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    expect(audit?.entityType).toBe("PatientDocument");
    expect(audit?.entityId).toBe(body.id);
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).not.toContain("dentaire-secret");
    expect(serialized).not.toContain("blobKey");
    expect(serialized).toContain(patient.id);
  });

  it("rejects an oversized file with 413 BEFORE reading the bytes — putDocument never called, arrayBuffer never called, no row", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const arrayBufferSpy = vi.spyOn(File.prototype, "arrayBuffer");

    try {
      const response = await uploadRequest(patient.id, cookie, {
        bytes: zeroBytes(MAX_DOCUMENT_BYTES + 1),
      });
      expect(response.status).toBe(413);
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("DOCUMENT_TOO_LARGE");
      expect(mockedPut).not.toHaveBeenCalled();
      // MINEUR-2 (step-2 audit): the oversize gate reads file.size only.
      expect(arrayBufferSpy).not.toHaveBeenCalled();
      expect(await getPrisma().patientDocument.count()).toBe(0);
    } finally {
      arrayBufferSpy.mockRestore();
    }
  });

  it("accepts a file of exactly MAX_DOCUMENT_BYTES — the cap is inclusive", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await uploadRequest(patient.id, cookie, {
      bytes: realJpegBytes(MAX_DOCUMENT_BYTES),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { sizeBytes: number };
    expect(body.sizeBytes).toBe(MAX_DOCUMENT_BYTES);
    expect(mockedPut).toHaveBeenCalledTimes(1);
  });

  it("rejects an HTML payload renamed .jpg with 415 — stored-XSS guard, nothing stored", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await uploadRequest(patient.id, cookie, {
      bytes: textBytes("<script>alert(1)</script>"),
      name: "radio.jpg",
      declaredMimeType: "image/jpeg",
    });
    expect(response.status).toBe(415);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("DOCUMENT_TYPE_NOT_ALLOWED");
    // The message is the generic FR string — no file name, no type echo.
    expect(body.error.message).toBe("Ce type de fichier n'est pas autorisé.");
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });

  it("rejects an SVG with 415 when it masquerades as an allow-listed type, and rejects an honestly-declared SVG too", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const svgBytes = textBytes(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );

    const masquerade = await uploadRequest(patient.id, cookie, {
      bytes: svgBytes,
      name: "radio.jpg",
      declaredMimeType: "image/jpeg",
    });
    expect(masquerade.status).toBe(415);
    expect(mockedPut).not.toHaveBeenCalled();

    // The shared Zod enum (derived from ALLOWED_TYPES) rejects image/svg+xml
    // before the byte validator — a flat 400, still a rejection.
    const honest = await uploadRequest(patient.id, cookie, {
      bytes: svgBytes,
      name: "radio.svg",
      declaredMimeType: "image/svg+xml",
    });
    expect(honest.status).toBe(400);
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });

  it.each([
    ["control character", "radio\u0000.jpg"],
    ["carriage return", "radio\r.jpg"],
    ["double quote", 'rad"io.jpg'],
    ["..", "radio..jpg"],
  ])("rejects an invalid name (%s) with 400 from the shared Zod schema — nothing stored", async (_label, name) => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await uploadRequest(patient.id, cookie, { name });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });

  it("404s for an unknown patient id and stores nothing", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);

    const response = await uploadRequest("does-not-exist", cookie);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });

  it("400s on a bodyless POST (no multipart formData at all)", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const response = await patientDocumentsPostRoute(
      new NextRequest(`http://localhost:3000/api/admin/patients/${patient.id}/documents`, {
        method: "POST",
        headers: { cookie },
      }),
      ctx(patient.id),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });

  it("502s when the blob SDK put fails, and creates no row", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    mockedPut.mockRejectedValueOnce(new Error("network down"));

    const response = await uploadRequest(patient.id, cookie);
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BLOB_OPERATION_FAILED");
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });

  it("503s when BLOB_READ_WRITE_TOKEN is missing — before any SDK call or row", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");

    const response = await uploadRequest(patient.id, cookie);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("BLOB_NOT_CONFIGURED");
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });

  it("409 PATIENT_ANONYMIZED — an erased chart must never receive a fresh document", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    // Route-impossible state: no route callable from here can produce a
    // patient row carrying anonymizedAt, so it is created directly via
    // getPrisma() under the fixture rule — the only way to pin the guard.
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Anonymisé",
        lastName: "Anonymisé",
        phone: `05${Math.floor(10000000 + Math.random() * 89999999)}`,
        phoneE164: `+2135${Math.floor(1000000 + Math.random() * 8999999)}`,
        anonymizedAt: new Date(),
      },
    });

    const response = await uploadRequest(patient.id, cookie);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("PATIENT_ANONYMIZED");
    expect(body.error.message).toBe("Cette fiche a été anonymisée et ne peut plus être modifiée.");
    expect(mockedPut).not.toHaveBeenCalled();
    expect(await getPrisma().patientDocument.count()).toBe(0);
  });
});

describe("GET /api/admin/patients/[id]/documents", () => {
  it("lists the patient's documents, metadata only — never blobKey, with the uploader's name", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie, { name: "radio-a.jpg" });
    expect(upload.status).toBe(201);

    const response = await listRequest(patient.id, cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ["id", "name", "mimeType", "sizeBytes", "uploadedAt", "uploadedBy"].sort(),
    );
    expect(body.items[0].name).toBe("radio-a.jpg");
    expect(body.items[0].uploadedBy).toBe(staff.name);
    // No blobKey anywhere in the serialized payload.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("blobKey");
    const row = await getPrisma().patientDocument.findFirstOrThrow();
    expect(serialized).not.toContain(row.blobKey);
  });

  it("orders newest first", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const first = await uploadRequest(patient.id, cookie, { name: "radio-a.jpg" });
    const second = await uploadRequest(patient.id, cookie, { name: "radio-b.jpg" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstId = ((await first.json()) as { id: string }).id;
    const secondId = ((await second.json()) as { id: string }).id;

    const response = await listRequest(patient.id, cookie);
    const body = (await response.json()) as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(2);
    expect(body.items.map((i) => i.id)).toEqual([secondId, firstId]);
  });

  it("404s for an unknown patient id", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);

    const response = await listRequest("does-not-exist", cookie);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("409 PATIENT_ANONYMIZED — the read side is closed for an erased chart too", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    // Route-impossible state: no route callable from here can produce a
    // patient row carrying anonymizedAt, so it is created directly via
    // getPrisma() under the fixture rule — the only way to pin the guard.
    const patient = await getPrisma().patient.create({
      data: {
        firstName: "Anonymisé",
        lastName: "Anonymisé",
        phone: `05${Math.floor(10000000 + Math.random() * 89999999)}`,
        phoneE164: `+2135${Math.floor(1000000 + Math.random() * 8999999)}`,
        anonymizedAt: new Date(),
      },
    });

    const response = await listRequest(patient.id, cookie);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("PATIENT_ANONYMIZED");
    expect(body.error.message).toBe("Cette fiche a été anonymisée et ne peut plus être modifiée.");
  });
});

describe("GET /api/admin/documents/[id] (download — step 4)", () => {
  it("streams the bytes with the stored Content-Type and an attachment Content-Disposition, and audits the download", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();
    const bytes = realJpegBytes(1024);

    const upload = await uploadRequest(patient.id, cookie, { bytes, name: "radio-b.jpg" });
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;

    mockedGet.mockResolvedValue({
      statusCode: 200,
      stream: streamOf(bytes),
    } as unknown as Awaited<ReturnType<typeof get>>);

    const response = await downloadRequest(docId, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    const disposition = response.headers.get("Content-Disposition") ?? "";
    expect(disposition.startsWith("attachment; filename=")).toBe(true);
    expect(disposition).toContain("radio-b.jpg");
    // The streamed bytes are the uploaded ones, end to end.
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    // The adapter's private-access contract, same as the upload control.
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet.mock.calls[0][1]).toMatchObject({ access: "private" });

    const audit = await lastAudit(AuditAction.PATIENT_DOCUMENT_DOWNLOADED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    expect(audit?.entityType).toBe("PatientDocument");
    expect(audit?.entityId).toBe(docId);
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).not.toContain("radio-b.jpg");
    expect(serialized).not.toContain("blobKey");
    expect(serialized).toContain(patient.id);
  });

  it("encodes an Arabic name with an apostrophe per RFC 5987 — exact filename*=UTF-8'' header, ASCII fallback present", async () => {
    const staff = await createStaff();
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie, { name: "radio d'أشعة.jpg" });
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;

    const bytes = realJpegBytes(64);
    mockedGet.mockResolvedValue({
      statusCode: 200,
      stream: streamOf(bytes),
    } as unknown as Awaited<ReturnType<typeof get>>);

    const response = await downloadRequest(docId, cookie);
    expect(response.status).toBe(200);
    // Hand-computed expectation (NOT recomputed with the route's own code):
    //   encodeURIComponent then ' -> %27; non-ASCII -> '_' in the fallback.
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="radio d'____.jpg"; filename*=UTF-8''radio%20d%27%D8%A3%D8%B4%D8%B9%D8%A9.jpg`,
    );
  });

  it("404-indistinguishable: a deleted doc and a nonexistent id produce byte-identical 404s on GET and DELETE", async () => {
    const staff = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie);
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;

    const deleted = await deleteDocumentRequest(docId, cookie);
    expect(deleted.status).toBe(200);

    const getDeleted = await downloadRequest(docId, cookie);
    const getMissing = await downloadRequest("does-not-exist", cookie);
    const deleteDeleted = await deleteDocumentRequest(docId, cookie);
    const deleteMissing = await deleteDocumentRequest("does-not-exist", cookie);

    for (const response of [getDeleted, getMissing, deleteDeleted, deleteMissing]) {
      expect(response.status).toBe(404);
    }
    // Same status AND same body for all four — existence is never confirmed.
    const bodies = await Promise.all(
      [getDeleted, getMissing, deleteDeleted, deleteMissing].map((r) => r.text()),
    );
    expect(new Set(bodies).size).toBe(1);
  });

  it("anonymized chart: downloading the patient's document returns the byte-identical indistinguishable 404", async () => {
    const staff = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie);
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;

    // Route-impossible state: no route callable from here can set
    // anonymizedAt on an existing chart (the anonymize route erases names
    // in the same transaction), so it is set directly via getPrisma() —
    // the only way to pin the read-closure guard.
    await getPrisma().patient.update({
      where: { id: patient.id },
      data: { anonymizedAt: new Date() },
    });

    const response = await downloadRequest(docId, cookie);
    const missing = await downloadRequest("does-not-exist", cookie);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(await missing.text());
    // Read-closure only: nothing was deleted, the blob was never touched.
    const row = await getPrisma().patientDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(row.deletedAt).toBeNull();
    expect(mockedGet).not.toHaveBeenCalled();
    expect(await lastAudit(AuditAction.PATIENT_DOCUMENT_DOWNLOADED)).toBeNull();
  });

  it("anonymized chart: deleting the patient's document returns the byte-identical indistinguishable 404", async () => {
    const staff = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie);
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;

    // Route-impossible state, same reasoning as the GET test above.
    await getPrisma().patient.update({
      where: { id: patient.id },
      data: { anonymizedAt: new Date() },
    });

    const response = await deleteDocumentRequest(docId, cookie);
    const missing = await deleteDocumentRequest("does-not-exist", cookie);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(await missing.text());
    // Nothing was soft-deleted, the blob was never touched.
    const row = await getPrisma().patientDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(row.deletedAt).toBeNull();
    expect(mockedDel).not.toHaveBeenCalled();
    expect(await lastAudit(AuditAction.PATIENT_DOCUMENT_DELETED)).toBeNull();
  });
});

describe("DELETE /api/admin/documents/[id] (soft delete — step 4)", () => {
  it("soft-deletes the row FIRST, then deletes the blob; audits blobDeleted: true; never exposes blobKey", async () => {
    const staff = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie, { name: "radio-c.jpg" });
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;
    const rowBefore = await getPrisma().patientDocument.findUniqueOrThrow({ where: { id: docId } });

    // Order proof: at the moment the SDK delete fires, the row must ALREADY
    // be soft-deleted (DB first, blob second).
    let deletedAtWhenDelCalled: Date | null = null;
    mockedDel.mockImplementationOnce(async () => {
      const row = await getPrisma().patientDocument.findUniqueOrThrow({ where: { id: docId } });
      deletedAtWhenDelCalled = row.deletedAt;
    });

    const response = await deleteDocumentRequest(docId, cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { blobDeleted: boolean };
    expect(body.blobDeleted).toBe(true);

    const row = await getPrisma().patientDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(staff.id);
    expect(row.blobKey).toBe(rowBefore.blobKey);
    expect(mockedDel).toHaveBeenCalledTimes(1);
    // The DB update ran before the blob delete.
    expect(deletedAtWhenDelCalled).not.toBeNull();

    const audit = await lastAudit(AuditAction.PATIENT_DOCUMENT_DELETED);
    expect(audit?.actorType).toBe(AuditActorType.STAFF);
    expect(audit?.userId).toBe(staff.id);
    expect(audit?.entityType).toBe("PatientDocument");
    expect(audit?.entityId).toBe(docId);
    const serialized = JSON.stringify(audit?.detail);
    expect(serialized).toContain("blobDeleted");
    expect(serialized).toContain("true");
    expect(serialized).not.toContain("radio-c.jpg");
    expect(serialized).not.toContain("blobKey");
    expect(serialized).toContain(patient.id);
  });

  it("blob delete fails -> still 200 with blobDeleted: false, row stays soft-deleted, audit says so", async () => {
    const staff = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie);
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;

    mockedDel.mockRejectedValueOnce(new Error("network down"));

    const response = await deleteDocumentRequest(docId, cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { blobDeleted: boolean };
    expect(body.blobDeleted).toBe(false);

    const row = await getPrisma().patientDocument.findUniqueOrThrow({ where: { id: docId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(staff.id);

    const audit = await lastAudit(AuditAction.PATIENT_DOCUMENT_DELETED);
    const detail = audit?.detail as { blobDeleted?: boolean };
    expect(detail.blobDeleted).toBe(false);
  });

  it("a soft-deleted document disappears from the step-3 list", async () => {
    const staff = await createStaff(Role.ADMIN);
    const cookie = await cookieFor(staff);
    const patient = await createPatient();

    const upload = await uploadRequest(patient.id, cookie, { name: "radio-d.jpg" });
    expect(upload.status).toBe(201);
    const docId = ((await upload.json()) as { id: string }).id;

    const before = await listRequest(patient.id, cookie);
    expect(((await before.json()) as { total: number }).total).toBe(1);

    const del = await deleteDocumentRequest(docId, cookie);
    expect(del.status).toBe(200);

    const after = await listRequest(patient.id, cookie);
    expect(after.status).toBe(200);
    const body = (await after.json()) as { items: unknown[]; total: number };
    expect(body.total).toBe(0);
    expect(body.items).toHaveLength(0);
  });
});
