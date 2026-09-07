import { describe, it, expect, vi } from "vitest";
import { getPrisma } from "@/lib/db";
import { listActiveSmileCases, listFeaturedSmileCases, getSmileCaseByKey } from "./content";

// next/cache has no runtime outside Next (unstable_cache throws without an
// incremental cache). Stub it — same approach as tests/public-content.test.ts.
vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
  unstable_cache: vi.fn((cb) => cb),
}));

// G1 — public read path for patient case gallery. Seed rows are synthetic
// (placeholder images, invented titles); no real patient data, ever.

async function seedCase(overrides: Record<string, unknown> = {}) {
  const n = Math.random().toString(36).slice(2);
  return getPrisma().smileCase.create({
    data: {
      key: `case-${n}`,
      title: { fr: `Titre ${n}`, ar: `عنوان ${n}`, en: `Title ${n}` },
      description: { fr: `Description ${n}` },
      beforeImageUrl: "/images/beforewhitening.jpeg",
      afterImageUrl: "/images/afterwhitening.jpeg",
      active: true,
      sortOrder: 0,
      ...overrides,
    },
  });
}

describe("listActiveSmileCases", () => {
  it("returns only active cases ordered by sortOrder with localized fields", async () => {
    await seedCase({ key: "zz-second", sortOrder: 2, title: { fr: "Second" } });
    await seedCase({ key: "aa-first", sortOrder: 1, title: { fr: "Premier" } });
    await seedCase({ key: "hidden", active: false, sortOrder: 0, title: { fr: "Caché" } });

    const items = await listActiveSmileCases("fr");
    expect(items.map((i) => i.key)).toEqual(["aa-first", "zz-second"]);
    expect(items[0].title).toBe("Premier");
    expect(items[0].beforeImageUrl).toBe("/images/beforewhitening.jpeg");
    expect(items[0].afterImageUrl).toBe("/images/afterwhitening.jpeg");
  });

  it("falls back to FR when the requested locale is missing", async () => {
    await seedCase({ key: "fallback", title: { fr: "Seulement FR" }, description: { fr: "Desc FR" } });
    const items = await listActiveSmileCases("ar");
    expect(items[0].title).toBe("Seulement FR");
    expect(items[0].description).toBe("Desc FR");
  });
});

describe("listFeaturedSmileCases", () => {
  it("returns only active featured cases ordered by featuredOrder", async () => {
    await seedCase({ key: "f2", featured: true, featuredOrder: 2 });
    await seedCase({ key: "f1", featured: true, featuredOrder: 1 });
    await seedCase({ key: "plain", featured: false });
    await seedCase({ key: "draft-feat", featured: true, active: false });

    const items = await listFeaturedSmileCases("fr");
    expect(items.map((i) => i.key)).toEqual(["f1", "f2"]);
  });
});

describe("getSmileCaseByKey", () => {
  it("returns the case with extras ordered, null for unknown or inactive", async () => {
    const c = await seedCase({ key: "detail" });
    await getPrisma().smileCaseImage.createMany({
      data: [
        { caseId: c.id, imageUrl: "/images/smile.jpg", caption: { fr: "B" }, sortOrder: 2 },
        { caseId: c.id, imageUrl: "/images/smile.jpg", caption: { fr: "A" }, sortOrder: 1 },
      ],
    });
    await seedCase({ key: "inactive-detail", active: false });

    const found = await getSmileCaseByKey("detail", "fr");
    expect(found?.key).toBe("detail");
    expect(found?.images.map((i) => i.caption)).toEqual(["A", "B"]);
    expect(await getSmileCaseByKey("nope", "fr")).toBeNull();
    expect(await getSmileCaseByKey("inactive-detail", "fr")).toBeNull();
  });
});
