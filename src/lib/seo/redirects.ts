/**
 * Legacy redirects from clinicorthocare.com (Task 23).
 *
 * Source audit (2026-09-04 via live fetch):
 * - https://clinicorthocare.com/page-sitemap.xml lists exactly 2 URLs:
 *   `/` (2026-04-26) and `/privacy-policy/` (2026-03-28).
 * - Homepage links are anchor sections (#À-propos, #nos-service,
 *   #transformations, #contact) — no deep pages to map.
 * - Old site is WordPress (AIOSEO); no /wp-*, /blog, or service slugs indexed.
 *
 * Mapping: old FR-only pages -> new /fr/* pages. `/` is served by the new
 * homepageLocale redirect already (no rule needed); only /privacy-policy/*
 * needs an explicit rule. Note: Next.js `permanent: true` emits 308
 * (Google treats 301/308 equivalently for ranking transfer).
 */

export type LegacyRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
};

export const LEGACY_REDIRECTS: LegacyRedirect[] = [
  // Trailing-slash + non-slash variants (Next normalizes, but be explicit).
  { source: "/privacy-policy", destination: "/fr/privacy", permanent: true },
  { source: "/privacy-policy/", destination: "/fr/privacy", permanent: true },
];
