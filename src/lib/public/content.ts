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

export const listActiveFaqItems = isDev
  ? fetchFaqItems
  : unstable_cache(fetchFaqItems, ["faq-items"], { tags: ["faq"], revalidate: 3600 });

export const listActiveTestimonials = isDev
  ? fetchTestimonials
  : unstable_cache(fetchTestimonials, ["testimonials"], {
      tags: ["testimonial"],
      revalidate: 3600,
    });

// --- Patient case gallery (SmileCase) ---
// Same caching discipline as the fetchers above: fresh reads in dev,
// hourly Data Cache in production, invalidated by the admin cases API via
// the shared `gallery` tag (see revalidateTagSafe call sites).

export type PublicSmileCase = {
  id: string;
  key: string;
  title: string;
  description: string;
  beforeImageUrl: string;
  afterImageUrl: string;
  featured: boolean;
};

export type PublicSmileCaseDetail = PublicSmileCase & {
  images: { id: string; imageUrl: string; caption: string }[];
};

const caseListSelect = {
  id: true,
  key: true,
  title: true,
  description: true,
  beforeImageUrl: true,
  afterImageUrl: true,
  featured: true,
} as const;

type SmileCaseListRow = {
  id: string;
  key: string;
  title: unknown;
  description: unknown;
  beforeImageUrl: string;
  afterImageUrl: string;
  featured: boolean;
};

function toPublicCase(r: SmileCaseListRow, locale: string): PublicSmileCase {
  return {
    id: r.id,
    key: r.key,
    title: localized(r.title as LocalizedField, locale),
    description: localized(r.description as LocalizedField, locale),
    beforeImageUrl: r.beforeImageUrl,
    afterImageUrl: r.afterImageUrl,
    featured: r.featured,
  };
}

async function fetchActiveSmileCases(locale: string): Promise<PublicSmileCase[]> {
  const rows = await getPrisma().smileCase.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    select: caseListSelect,
  });
  return rows.map((r) => toPublicCase(r, locale));
}

async function fetchFeaturedSmileCases(locale: string): Promise<PublicSmileCase[]> {
  const rows = await getPrisma().smileCase.findMany({
    where: { active: true, featured: true },
    orderBy: [{ featuredOrder: "asc" }, { sortOrder: "asc" }],
    select: caseListSelect,
  });
  return rows.map((r) => toPublicCase(r, locale));
}

async function fetchSmileCaseByKey(key: string, locale: string): Promise<PublicSmileCaseDetail | null> {
  const row = await getPrisma().smileCase.findFirst({
    where: { key, active: true },
    select: {
      ...caseListSelect,
      images: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { id: true, imageUrl: true, caption: true },
      },
    },
  });
  if (!row) return null;
  return {
    ...toPublicCase(row, locale),
    images: row.images.map((i) => ({
      id: i.id,
      imageUrl: i.imageUrl,
      caption: localized(i.caption as LocalizedField, locale),
    })),
  };
}

export const listActiveSmileCases = isDev
  ? fetchActiveSmileCases
  : unstable_cache(fetchActiveSmileCases, ["smile-cases"], {
      tags: ["gallery"],
      revalidate: 3600,
    });

export const listFeaturedSmileCases = isDev
  ? fetchFeaturedSmileCases
  : unstable_cache(fetchFeaturedSmileCases, ["smile-cases-featured"], {
      tags: ["gallery"],
      revalidate: 3600,
    });

async function fetchSmileCaseByKeyUncached(key: string, locale: string) {
  return fetchSmileCaseByKey(key, locale);
}

// Detail pages vary by key, so the cache key must include it — unlike the
// list fetchers above, this wrapper can't be passed straight through.
export const getSmileCaseByKey = isDev
  ? fetchSmileCaseByKey
  : (key: string, locale: string) =>
      unstable_cache(fetchSmileCaseByKeyUncached, ["smile-case", key, locale], {
        tags: ["gallery"],
        revalidate: 3600,
      })(key, locale);
