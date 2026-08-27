import { getPrisma } from "@/lib/db";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { unstable_cache } from "next/cache";

// Nothing in this codebase ever calls revalidateTag(["faq" | "testimonial" |
// "gallery"]) — there is no back-office yet to trigger it (that lands with the
// staff dashboard). Without it, unstable_cache's Data Cache happily serves a
// stale (or, right after a fresh `db:seed` on an until-then-empty table, an
// empty []) result for a full hour. In development that makes the app lie
// about what is in the database, which is exactly what you don't want while
// iterating on seed data. So: cache only outside development; `revalidate: 0`
// is not a valid option (unstable-cache.js throws), so this is a straight
// env branch instead of tuning the TTL down to zero.
const isDev = process.env.NODE_ENV === "development";

async function fetchFaqItems(locale: string) {
  // orderBy is required: without it Postgres makes no ordering guarantee, and
  // a re-seed (upsert) can visibly reshuffle the list on every deploy.
  const rows = await getPrisma().faqItem.findMany({
    where: { active: true },
    orderBy: { key: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    question: localized(r.question as LocalizedField, locale),
    answer: localized(r.answer as LocalizedField, locale),
  }));
}

async function fetchTestimonials(locale: string) {
  const rows = await getPrisma().testimonial.findMany({
    where: { active: true },
    orderBy: { key: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    author: localized(r.author as LocalizedField, locale),
    content: localized(r.content as LocalizedField, locale),
    rating: r.rating,
  }));
}

async function fetchGalleryItems(locale: string) {
  // Gallery keys are zero-padded (g01, g02, … g12) precisely so this sort
  // gives the intended editorial order, including consecutive before/after
  // pairs — see prisma/seed.ts.
  const rows = await getPrisma().galleryItem.findMany({
    where: { active: true },
    orderBy: { key: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    imageUrl: r.imageUrl,
    caption: localized(r.caption as LocalizedField, locale),
  }));
}

export const listActiveFaqItems = isDev
  ? fetchFaqItems
  : unstable_cache(fetchFaqItems, ["faq-items"], { tags: ["faq"], revalidate: 3600 });

export const listActiveTestimonials = isDev
  ? fetchTestimonials
  : unstable_cache(fetchTestimonials, ["testimonials"], {
      tags: ["testimonial"],
      revalidate: 3600,
    });

export const listActiveGalleryItems = isDev
  ? fetchGalleryItems
  : unstable_cache(fetchGalleryItems, ["gallery-items"], {
      tags: ["gallery"],
      revalidate: 3600,
    });
