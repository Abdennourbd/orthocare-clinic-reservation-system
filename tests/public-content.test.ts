import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listActiveFaqItems,
  listActiveTestimonials,
  listActiveGalleryItems,
} from "../src/lib/public/content";
import { getPrisma } from "../src/lib/db";

vi.mock("next/cache", () => ({
  unstable_cache: vi.fn((cb) => cb),
}));

vi.mock("../src/lib/db", () => ({
  getPrisma: vi.fn(),
}));

describe("Public Content", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches active FAQ items localized", async () => {
    const mockFaq = [
      {
        id: "faq-1",
        question: { fr: "Question 1 FR", en: "Question 1 EN" },
        answer: { fr: "Answer 1 FR", en: "Answer 1 EN" },
        active: true,
      },
    ];

    const mockPrisma = {
      faqItem: {
        findMany: vi.fn().mockResolvedValue(mockFaq),
      },
    };
    vi.mocked(getPrisma).mockReturnValue(mockPrisma as unknown as ReturnType<typeof getPrisma>);

    const items = await listActiveFaqItems("fr");
    
    expect(mockPrisma.faqItem.findMany).toHaveBeenCalledWith({
      where: { active: true },
    });
    expect(items).toEqual([
      {
        id: "faq-1",
        question: "Question 1 FR",
        answer: "Answer 1 FR",
      },
    ]);
  });

  it("fetches active Testimonials localized", async () => {
    const mockTestimonials = [
      {
        id: "test-1",
        author: { fr: "Auteur 1 FR", en: "Author 1 EN" },
        content: { fr: "Contenu 1 FR", en: "Content 1 EN" },
        rating: 5,
        active: true,
      },
    ];

    const mockPrisma = {
      testimonial: {
        findMany: vi.fn().mockResolvedValue(mockTestimonials),
      },
    };
    vi.mocked(getPrisma).mockReturnValue(mockPrisma as unknown as ReturnType<typeof getPrisma>);

    const items = await listActiveTestimonials("en");
    
    expect(mockPrisma.testimonial.findMany).toHaveBeenCalledWith({
      where: { active: true },
    });
    expect(items).toEqual([
      {
        id: "test-1",
        author: "Author 1 EN",
        content: "Content 1 EN",
        rating: 5,
      },
    ]);
  });

  it("fetches active Gallery items localized", async () => {
    const mockGallery = [
      {
        id: "gal-1",
        imageUrl: "/image1.jpg",
        caption: { fr: "Légende 1 FR", en: "Caption 1 EN" },
        active: true,
      },
    ];

    const mockPrisma = {
      galleryItem: {
        findMany: vi.fn().mockResolvedValue(mockGallery),
      },
    };
    vi.mocked(getPrisma).mockReturnValue(mockPrisma as unknown as ReturnType<typeof getPrisma>);

    const items = await listActiveGalleryItems("fr");
    
    expect(mockPrisma.galleryItem.findMany).toHaveBeenCalledWith({
      where: { active: true },
    });
    expect(items).toEqual([
      {
        id: "gal-1",
        imageUrl: "/image1.jpg",
        caption: "Légende 1 FR",
      },
    ]);
  });
});
