import { parseLocale } from "@/lib/i18n/config";

/**
 * The self-service URL embedded in the confirmation/reschedule SMS. Locale is
 * validated against the allow-list so a stored patient locale can never
 * inject an arbitrary path segment. `APP_URL` is the production site origin.
 */
export function buildSelfServiceLink(
  rawToken: string,
  locale: string,
): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  const loc = parseLocale(locale);
  return `${base}/${loc}/appointment/${rawToken}`;
}