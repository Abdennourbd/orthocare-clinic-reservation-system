import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listActiveFaqItems,
  listActiveTestimonials,
} from "../src/lib/public/content";
import {
  listActiveServices,
  getActiveServiceBySlug,
  formatPrice,
} from "../src/lib/public/services";
import { getPrisma } from "../src/lib/db";

// Content queries are exercised against the REAL test database (project test
// strategy: no mocks-of-mocks). Only next/cache is stubbed so unstable_cache
// passes through instead of caching across suites.

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((cb) => cb),
}));

async function seedContent() {
  const prisma = getPrisma();
  await prisma.faqItem.createMany({
    data: [
      {
        key: "faq2",
        question: { fr: "Question 2 FR", en: "Question 2 EN", ar: "س2" },
        answer: { fr: "Réponse 2 FR", en: "Answer 2 EN", ar: "ج2" },
        active: true,
      },
      {
        key: "faq1",
        question: { fr: "Question 1 FR", en: "Question 1 EN" },
        answer: { fr: "Réponse 1 FR", en: "Answer 1 EN" },
        active: true,
      },
      {
        key: "faq-inactive",
        question: { fr: "Inactive FR" },
        answer: { fr: "Inactive FR" },
        active: false,
      },
    ],
  });

  await prisma.testimonial.createMany({
    data: [
      {
        key: "t1",
        author: { fr: "Auteur 1 FR", en: "Author 1 EN" },
        content: { fr: "Contenu 1 FR", en: "Content 1 EN" },
        rating: 5,
        active: true,
      },
    ],
  });
}

describe("Public Content", () => {
  beforeEach(async () => {
    await seedContent();
  });

  it("fetches active FAQ items localized, ordered by key, inactive excluded", async () => {
    const items = await listActiveFaqItems("fr");
    expect(items).toEqual([
      { id: expect.any(String), question: "Question 1 FR", answer: "Réponse 1 FR" },
      { id: expect.any(String), question: "Question 2 FR", answer: "Réponse 2 FR" },
    ]);
  });

  it("falls back to FR when the requested locale field is missing", async () => {
    const items = await listActiveFaqItems("ar");
    // faq1 has no `ar` — localized() must fall back to FR, not crash or drop it.
    expect(items).toEqual([
      { id: expect.any(String), question: "Question 1 FR", answer: "Réponse 1 FR" },
      { id: expect.any(String), question: "س2", answer: "ج2" },
    ]);
  });

  it("fetches active testimonials localized", async () => {
    const items = await listActiveTestimonials("en");
    expect(items).toEqual([
      { id: expect.any(String), author: "Author 1 EN", content: "Content 1 EN", rating: 5 },
    ]);
  });
});

describe("Public Services", () => {
  beforeEach(async () => {
    await getPrisma().service.createMany({
      data: [
        {
          slug: "consultation",
          name: { fr: "Consultation FR", en: "Consultation EN" },
          description: { fr: "D FR", en: "D EN" },
          durationMinutes: 30,
          price: 2000,
          currency: "DZD",
          active: true,
        },
        {
          slug: "hidden",
          name: { fr: "Caché" },
          description: { fr: "D" },
          durationMinutes: 15,
          active: false,
        },
      ],
    });
  });

  it("lists active services localized, inactive excluded", async () => {
    const items = await listActiveServices("en");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slug: "consultation",
      name: "Consultation EN",
      durationMinutes: 30,
      price: 2000,
      currency: "DZD",
    });
  });

  it("falls back to FR when the requested locale field is missing", async () => {
    const items = await listActiveServices("ar");
    expect(items[0].name).toBe("Consultation FR");
  });

  it("resolves a service by slug, null for unknown or inactive", async () => {
    expect((await getActiveServiceBySlug("consultation", "fr"))?.name).toBe(
      "Consultation FR",
    );
    expect(await getActiveServiceBySlug("nope", "fr")).toBeNull();
    expect(await getActiveServiceBySlug("hidden", "fr")).toBeNull();
  });

  it("formats prices with locale grouping, free for null/zero", () => {
    expect(formatPrice(null, "DZD", "Gratuit", "fr")).toBe("Gratuit");
    expect(formatPrice(0, "DZD", "Gratuit", "fr")).toBe("Gratuit");
    expect(formatPrice(2000, "DZD", "Gratuit", "fr")).toContain("DZD");
  });
});
