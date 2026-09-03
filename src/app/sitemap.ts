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
  let services: { slug: string; updatedAt: Date }[] = [];
  try {
    const { getPrisma } = await import("@/lib/db");
    services = await getPrisma().service.findMany({
      where: { active: true },
      select: { slug: true, updatedAt: true },
    });
  } catch (err) {
    // Build without DB (CI): static-only sitemap. Warn so a real prod
    // misconfiguration doesn't go silently unnoticed.
    console.warn("[sitemap] DB unreachable, emitting static paths only", err);
    services = [];
  }

  const updatedBySlug = new Map(services.map((s) => [`/services/${s.slug}`, s.updatedAt]));

  const paths = [...STATIC_PATHS, ...services.map((s) => `/services/${s.slug}`)];

  return LOCALES.flatMap((locale) =>
    paths.map((p) => ({
      url: getCanonicalUrl(locale, p),
      lastModified: updatedBySlug.get(p) ?? undefined,
      changeFrequency: p === "/" ? "weekly" : "monthly",
      priority: p === "/" ? 1 : 0.7,
      alternates: {
        languages: getAlternateUrls(p) as Record<string, string>,
      },
    }))
  );
}
