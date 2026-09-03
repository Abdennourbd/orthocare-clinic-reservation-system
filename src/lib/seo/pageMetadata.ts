import type { Metadata } from "next";
import { getAlternateUrls, getCanonicalUrl, siteBaseUrl } from "./canonical";

function ogLocale(locale: string): string {
  return locale === "ar" ? "ar_DZ" : locale === "en" ? "en_US" : "fr_DZ";
}

/**
 * Full per-page SEO metadata (Task 23 fix for layout stamping "/" canonicals).
 * Every public page calls this with its own pathname so canonicals, hreflang
 * and OG urls point at the page itself — never the homepage.
 */
export function pageMetadata(
  locale: string,
  pathname: string,
  title: string,
  description: string
): Metadata {
  const canonical = getCanonicalUrl(locale, pathname);
  const languages = getAlternateUrls(pathname) as Record<string, string>;
  const current = ogLocale(locale);
  return {
    title,
    description,
    metadataBase: new URL(siteBaseUrl()),
    alternates: { canonical, languages },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Ortho'Care Clinic",
      locale: current,
      alternateLocale: ["fr_DZ", "ar_DZ", "en_US"].filter((l) => l !== current),
      type: "website",
      images: [
        {
          url: `${siteBaseUrl()}/images/smile.jpg`,
          alt: "Ortho'Care Clinic",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${siteBaseUrl()}/images/smile.jpg`],
    },
  };
}
