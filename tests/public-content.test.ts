import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listActiveFaqItems,
  listActiveTestimonials,
  listActiveGalleryItems,
} from "../src/lib/public/content";
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

  await prisma.galleryItem.createMany({
    data: [
      {
        key: "g01",
        imageUrl: "/image1.jpg",
        caption: { fr: "Légende 1 FR", en: "Caption 1 EN" },
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

  it("fetches active gallery items localized", async () => {
    const items = await listActiveGalleryItems("fr");
    expect(items).toEqual([
      { id: expect.any(String), imageUrl: "/image1.jpg", caption: "Légende 1 FR" },
    ]);
  });
});
