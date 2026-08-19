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
