/**
 * Canonical + hreflang URL helpers (Task 23).
 *
 * Single place that knows how public URLs map across the 3 locales.
 * `fr` is the default locale and the `x-default` target.
 */

import { routing } from "@/i18n/routing";

export type Locale = (typeof routing.locales)[number];

const LOCALES: readonly string[] = routing.locales;
export const DEFAULT_LOCALE = "fr";

/** Absolute site origin. Empty/whitespace APP_URL falls back to localhost (dev-safe). */
export function siteBaseUrl(): string {
  const raw = (process.env.APP_URL ?? "").trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

function baseUrl(): string {
  return siteBaseUrl();
}

function normalizePath(pathname: string): string {
  let p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  // Strip any leading locale prefix (/fr, /ar, /en) so callers can pass
  // either a bare path or a full localized path.
  for (const l of LOCALES) {
    if (p === `/${l}`) return "/";
    if (p.startsWith(`/${l}/`)) {
      p = p.slice(l.length + 1) || "/";
      break;
    }
  }
  // Single canonical spelling: strip trailing slash (except root).
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

/** Absolute canonical URL for a locale + path, e.g. https://site/fr/services */
export function getCanonicalUrl(locale: string, pathname = "/"): string {
  const path = normalizePath(pathname);
  const suffix = path === "/" ? "" : path;
  return `${baseUrl()}/${locale}${suffix}`;
}

/** All alternate URLs including x-default (which points at fr). */
export function getAlternateUrls(pathname = "/"): Record<string, string> {
  const path = normalizePath(pathname);
  const out: Record<string, string> = {};
  for (const l of LOCALES) {
    out[l] = getCanonicalUrl(l, path);
  }
  out["x-default"] = getCanonicalUrl(DEFAULT_LOCALE, path);
  return out;
}
