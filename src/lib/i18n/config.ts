// Central i18n config: locale list, default, and RTL mapping.
// Used by the `localized()` DB helper and the layout for `dir` detection.
// Keep in sync with `src/i18n/routing.ts` (next-intl routing).

export const locales = ["fr", "ar", "en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr";

// Arabic is the only RTL locale.
export const rtlLocales: ReadonlySet<string> = new Set(["ar"]);

export function isRtl(locale: string): boolean {
  return rtlLocales.has(locale);
}

/**
 * Parses a locale query parameter against the allow-list, defaulting to FR.
 * Used by public API routes (outside [locale]) which receive the locale from
 * `?locale=` rather than the URL prefix.
 */
export function parseLocale(value: string | null | undefined): Locale {
  if (value && (locales as readonly string[]).includes(value)) {
    return value as Locale;
  }
  return defaultLocale;
}
