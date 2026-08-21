import * as rootParams from "next/root-params";
import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { routing } from "./routing";

export default getRequestConfig(async ({ locale }) => {
  const effectiveLocale = locale ?? (await rootParams.locale());

  // Validate against the allow-list unconditionally — `locale` is interpolated
  // into a filesystem import path below, so it must never be attacker-controlled.
  if (!hasLocale(routing.locales, effectiveLocale)) {
    notFound();
  }

  return {
    locale: effectiveLocale,
    messages: (await import(`../../messages/${effectiveLocale}.json`)).default,
  };
});
