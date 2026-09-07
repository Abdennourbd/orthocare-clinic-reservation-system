import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { Role } from "@/generated/prisma/client";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { GET as casesList, POST as casesCreate } from "@/app/api/admin/cases/route";
import { PATCH as casePatch, DELETE as caseDelete } from "@/app/api/admin/cases/[id]/route";
import {
  POST as extraAdd,
  DELETE as extraDelete,
} from "@/app/api/admin/cases/[id]/images/route";
import { POST as imageUpload } from "@/app/api/admin/cases/upload/route";
import { put, del } from "@vercel/blob";

// next/cache has no runtime outside Next. Stub it — same approach as
// tests/integration/content-settings.test.ts.
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((cb) => cb),
}));

// Never touch the network: mock the Blob SDK, exercise the real adapter
// (src/lib/gallery/blobStorage.ts) — same approach as patient-documents.
vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));

const mockedPut = vi.mocked(put);
const mockedDel = vi.mocked(del);

// G2 — admin cases API: CRUD + extras + upload + consent/featured guards.
// Setup mirrors content-settings.test.ts (ADMIN + RECEPTIONIST, session
// cookie, NextRequest construction). Every ADMIN-only route asserts
// receptionist 403 + anonymous 401.

beforeEach(async () => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-for-vitest-only");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("TZ", "UTC");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test-blob-token");
  mockedPut.mockReset();
  mockedDel.mockReset();
  mockedPut.mockResolvedValue({ url: "https://x.public.blob.vercel-storage.com/cases/u.jpg" } as never);
  mockedDel.mockResolvedValue(undefined as never);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

async function createStaff(role: Role = Role.ADMIN) {
  return getPrisma().user.create({
    data: {
      name: "Cases Test",
      email: `cases-${Math.random().toString(36).slice(2)}@test.com`,
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

function req(method: string, path: string, body: unknown, cookie?: string, params?: Record<string, string>) {
  const url = new URL(path, "http://localhost:3000");
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return {
    request: new NextRequest(url, init),
    context: { params: Promise.resolve(params ?? {}) },
  };
}

const caseBody = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  title: { fr: `Titre ${key}` },
  description: { fr: `Description ${key}` },
  beforeImageUrl: "/images/beforewhitening.jpeg",
  afterImageUrl: "/images/afterwhitening.jpeg",
  ...extra,
});

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

function uploadReq(cookie: string | undefined, file: File, fileName = "avant.jpg", mime = "image/jpeg") {
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("declaredMimeType", mime);
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new NextRequest("http://localhost:3000/api/admin/cases/upload", {
    method: "POST",
    headers,
    body: form,
  });
}

describe("cases CRUD + consent gate", () => {
  it("admin creates a draft; draft is inactive by default", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const { request } = req("POST", "/api/admin/cases", caseBody("draft-1"), cookie);
    const res = await casesCreate(request);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { key: string; active: boolean } };
    expect(body.item.key).toBe("draft-1");
    expect(body.item.active).toBe(false);
  });

  it("publishing without consent is refused (create and patch)", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const create = req("POST", "/api/admin/cases", caseBody("nocon", { active: true }), cookie);
    expect((await casesCreate(create.request)).status).toBe(400);

    const draft = req("POST", "/api/admin/cases", caseBody("nocon2"), cookie);
    const draftBody = (await (await casesCreate(draft.request)).json()) as { item: { id: string } };
    const patch = req(
      "PATCH",
      `/api/admin/cases/${draftBody.item.id}`,
      { active: true },
      cookie,
      { id: draftBody.item.id },
    );
    expect((await casePatch(patch.request, patch.context)).status).toBe(400);
  });

  it("publishing with consent succeeds", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const { request } = req(
      "POST",
      "/api/admin/cases",
      caseBody("ok-1", { active: true, consentConfirmed: true }),
      cookie,
    );
    expect((await casesCreate(request)).status).toBe(201);
  });

  it("rejects non-http(s) image URLs", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const bad = req(
      "POST",
      "/api/admin/cases",
      caseBody("bad-url", { beforeImageUrl: "javascript:alert(1)" }),
      cookie,
    );
    expect((await casesCreate(bad.request)).status).toBe(400);
  });

  it("duplicate key is a 409; unknown id is a 404", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const first = req("POST", "/api/admin/cases", caseBody("dup"), cookie);
    expect((await casesCreate(first.request)).status).toBe(201);
    const second = req("POST", "/api/admin/cases", caseBody("dup"), cookie);
    expect((await casesCreate(second.request)).status).toBe(409);

    const patch = req("PATCH", "/api/admin/cases/does-not-exist", { active: false }, cookie, {
      id: "does-not-exist",
    });
    expect((await casePatch(patch.request, patch.context)).status).toBe(404);
    const delReq = req("DELETE", "/api/admin/cases/does-not-exist", undefined, cookie, {
      id: "does-not-exist",
    });
    expect((await caseDelete(delReq.request, delReq.context)).status).toBe(404);
  });

  it("receptionist is blocked, anonymous is rejected", async () => {
    const recep = await createStaff(Role.RECEPTIONIST);
    const recepCookie = await cookieFor(recep);
    const blocked = req("POST", "/api/admin/cases", caseBody("nope"), recepCookie);
    expect((await casesCreate(blocked.request)).status).toBe(403);
    const anon = req("POST", "/api/admin/cases", caseBody("nope2"));
    expect((await casesCreate(anon.request)).status).toBe(401);
    const list = await casesList(new NextRequest("http://localhost:3000/api/admin/cases"));
    expect(list.status).toBe(401);
  });
});

describe("featured cap (max 4 on home)", () => {
  it("featuring a 5th case is refused", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = req(
        "POST",
        "/api/admin/cases",
        caseBody(`feat-${i}`, { active: true, consentConfirmed: true, featured: true }),
        cookie,
      );
      const b = (await (await casesCreate(r.request)).json()) as { item: { id: string } };
      ids.push(b.item.id);
    }
    expect(ids).toHaveLength(4);
    const fifth = req("POST", "/api/admin/cases", caseBody("fifth"), cookie);
    const fifthBody = (await (await casesCreate(fifth.request)).json()) as { item: { id: string } };
    const feat = req(
      "PATCH",
      `/api/admin/cases/${fifthBody.item.id}`,
      { featured: true },
      cookie,
      { id: fifthBody.item.id },
    );
    expect((await casePatch(feat.request, feat.context)).status).toBe(409);
  });
});

describe("extras (max 8 per case)", () => {
  it("adds up to 8 extras, refuses the 9th, deletes one", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const created = req("POST", "/api/admin/cases", caseBody("with-extras"), cookie);
    const createdBody = (await (await casesCreate(created.request)).json()) as { item: { id: string } };
    const id = createdBody.item.id;

    for (let i = 0; i < 8; i++) {
      const r = req(
        "POST",
        `/api/admin/cases/${id}/images`,
        { imageUrl: "/images/smile.jpg", caption: { fr: `Photo ${i}` } },
        cookie,
        { id },
      );
      expect((await extraAdd(r.request, r.context)).status).toBe(201);
    }
    const ninth = req(
      "POST",
      `/api/admin/cases/${id}/images`,
      { imageUrl: "/images/smile.jpg", caption: { fr: "Trop" } },
      cookie,
      { id },
    );
    expect((await extraAdd(ninth.request, ninth.context)).status).toBe(409);

    const list = await getPrisma().smileCaseImage.findMany({ where: { caseId: id } });
    expect(list).toHaveLength(8);
    const one = req("DELETE", `/api/admin/cases/${id}/images`, { imageId: list[0].id }, cookie, { id });
    expect((await extraDelete(one.request, one.context)).status).toBe(200);
    expect(await getPrisma().smileCaseImage.count({ where: { caseId: id } })).toBe(7);
  });

  it("deleting the case cascades its extras", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const created = req("POST", "/api/admin/cases", caseBody("cascade"), cookie);
    const createdBody = (await (await casesCreate(created.request)).json()) as { item: { id: string } };
    const id = createdBody.item.id;
    const add = req(
      "POST",
      `/api/admin/cases/${id}/images`,
      { imageUrl: "/images/smile.jpg", caption: { fr: "X" } },
      cookie,
      { id },
    );
    expect((await extraAdd(add.request, add.context)).status).toBe(201);
    const delReq = req("DELETE", `/api/admin/cases/${id}`, undefined, cookie, { id });
    expect((await caseDelete(delReq.request, delReq.context)).status).toBe(200);
    expect(await getPrisma().smileCaseImage.count({ where: { caseId: id } })).toBe(0);
  });
});

describe("image upload", () => {
  it("stores a genuine JPEG and returns its public URL", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const res = await imageUpload(
      uploadReq(cookie, new File([jpegBytes], "avant.jpg", { type: "image/jpeg" })),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain("/cases/");
    expect(mockedPut).toHaveBeenCalledTimes(1);
  });

  it("rejects an HTML payload renamed to .jpg with 415 and never calls put", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    const html = new TextEncoder().encode("<html><script>alert(1)</script>");
    const res = await imageUpload(
      uploadReq(cookie, new File([html], "evil.jpg", { type: "image/jpeg" })),
    );
    expect(res.status).toBe(415);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("rejects a disallowed type at the metadata gate and an oversized file", async () => {
    const admin = await createStaff();
    const cookie = await cookieFor(admin);
    // "image/svg+xml" is not in the schema enum: 400 at the metadata gate,
    // before any byte is read — same convention as patient documents.
    const svg = uploadReq(cookie, new File([jpegBytes], "x.svg", { type: "image/svg+xml" }), "x.svg", "image/svg+xml");
    expect((await imageUpload(svg)).status).toBe(400);

    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    big.set([0xff, 0xd8, 0xff]);
    const bigRes = await imageUpload(uploadReq(cookie, new File([big], "big.jpg", { type: "image/jpeg" })));
    expect(bigRes.status).toBe(413);
    expect(mockedPut).not.toHaveBeenCalled();
  });

  it("receptionist is blocked", async () => {
    const recep = await createStaff(Role.RECEPTIONIST);
    const cookie = await cookieFor(recep);
    const res = await imageUpload(
      uploadReq(cookie, new File([jpegBytes], "avant.jpg", { type: "image/jpeg" })),
    );
    expect(res.status).toBe(403);
  });
});
