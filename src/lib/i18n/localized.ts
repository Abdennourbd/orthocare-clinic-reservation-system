import { defaultLocale } from "./config";

// A per-locale JSON field stored in the DB, e.g. `{ fr, ar, en }`.
export type LocalizedField = {
  [locale: string]: string | null | undefined;
} | null;

/**
 * Read the requested locale from a per-locale DB field, falling back to the
 * default locale (FR) when the requested locale is missing, and returning an
 * empty string when the field itself is null or the fallback is also absent.
 *
 * @param field    the per-locale JSON value, or null
 * @param locale   the locale to read first (e.g. "ar")
 * @param fallback locale to fall back to when `locale` is missing (default FR)
 */
export function localized(
  field: LocalizedField,
  locale: string,
  fallback: string = defaultLocale,
): string {
  if (!field) return "";
  const direct = field[locale];
  if (typeof direct === "string" && direct.length > 0) return direct;
  const fb = field[fallback];
  if (typeof fb === "string" && fb.length > 0) return fb;
  return "";
}
