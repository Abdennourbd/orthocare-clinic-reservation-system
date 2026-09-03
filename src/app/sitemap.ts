import type { MetadataRoute } from "next";
import { getAlternateUrls, getCanonicalUrl } from "@/lib/seo/canonical";

/**
 * Per-locale sitemap (Task 23).
 * Static pages always present; service detail URLs appended when the DB is
 * reachable at build time (falls back to static-only so `next build` never
 * fails without a database).
 */
const STATIC_PATHS = [
  "/",
  "/services",
  "/book",
  "/about",
  "/contact",
  "/faq",
  "/testimonials",
  "/gallery",
  "/privacy",
];

const LOCALES = ["fr", "ar", "en"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let serviceSlugs: string[] = [];
  try {
    const { getPrisma } = await import("@/lib/db");
    const rows = await getPrisma().service.findMany({
      where: { active: true },
      select: { slug: true, updatedAt: true },
    });
    serviceSlugs = rows.map((r) => r.slug);
  } catch {
    serviceSlugs = [];
  }

  const paths = [...STATIC_PATHS, ...serviceSlugs.map((s) => `/services/${s}`)];
  const now = new Date();

  return LOCALES.flatMap((locale) =>
    paths.map((p) => ({
      url: getCanonicalUrl(locale, p),
      lastModified: now,
      changeFrequency: p === "/" ? "weekly" : "monthly",
      priority: p === "/" ? 1 : 0.7,
      alternates: {
        languages: getAlternateUrls(p) as Record<string, string>,
      },
    }))
  );
}
