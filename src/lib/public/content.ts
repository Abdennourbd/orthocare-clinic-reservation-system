import { getPrisma } from "@/lib/db";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { unstable_cache } from "next/cache";

export const listActiveFaqItems = unstable_cache(
  async (locale: string) => {
    const rows = await getPrisma().faqItem.findMany({ where: { active: true } });
    return rows.map((r) => ({
      id: r.id,
      question: localized(r.question as LocalizedField, locale),
      answer: localized(r.answer as LocalizedField, locale),
    }));
  },
  ["faq-items"],
  { tags: ["faq"], revalidate: 3600 }
);

export const listActiveTestimonials = unstable_cache(
  async (locale: string) => {
    const rows = await getPrisma().testimonial.findMany({ where: { active: true } });
    return rows.map((r) => ({
      id: r.id,
      author: localized(r.author as LocalizedField, locale),
      content: localized(r.content as LocalizedField, locale),
      rating: r.rating,
    }));
  },
  ["testimonials"],
  { tags: ["testimonial"], revalidate: 3600 }
);

export const listActiveGalleryItems = unstable_cache(
  async (locale: string) => {
    const rows = await getPrisma().galleryItem.findMany({ where: { active: true } });
    return rows.map((r) => ({
      id: r.id,
      imageUrl: r.imageUrl,
      caption: localized(r.caption as LocalizedField, locale),
    }));
  },
  ["gallery-items"],
  { tags: ["gallery"], revalidate: 3600 }
);
