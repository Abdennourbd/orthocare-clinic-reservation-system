import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["fr", "ar", "en"],
  // French is the clinic's primary language (Algiers) and the `localized()`
  // helper falls back to FR. It is also the default when no locale matches.
  defaultLocale: "fr",
});
