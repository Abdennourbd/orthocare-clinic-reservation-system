import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/seo/canonical";

/**
 * robots.txt (Task 23).
 * Public pages crawlable; admin, API and self-service token pages excluded.
 * Token URLs carry a capability token — they must never be crawled or indexed.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/api/", "/fr/appointment/", "/ar/appointment/", "/en/appointment/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}
