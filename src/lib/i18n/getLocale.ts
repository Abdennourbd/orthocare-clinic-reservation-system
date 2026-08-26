import { getLocale } from "next-intl/server";
import { type Locale } from "./config";

/**
 * Typed locale for the current request. next-intl's `getLocale()` returns a
 * plain string; the i18n request layer already validates it against the
 * allow-list (src/i18n/request.ts), so the cast is safe — factored here so
 * server components don't each cast individually.
 *
 * SERVER-ONLY: imports `next-intl/server`. Never import from a client
 * component (it would break the client bundle). If a component is or may
 * become a client component, pass the locale down as a prop instead.
 */
export async function getAppLocale(): Promise<Locale> {
  return (await getLocale()) as Locale;
}