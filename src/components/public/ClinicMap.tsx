import { getTranslations } from "next-intl/server";
import { buildMapEmbedSrc } from "@/lib/maps/embed";
import { getAppLocale } from "@/lib/i18n/getLocale";

// Free no-key Google Maps iframe centred on the clinic (Task 10). Server
// component: the embed URL is a static string per locale, no client JS.
// `no-referrer` keeps the embed from seeing the page URL (there is no token
// on public pages, but sending less is cheap).
export default async function ClinicMap() {
  const [locale, t] = await Promise.all([
    getAppLocale(),
    getTranslations("Location"),
  ]);

  return (
    <iframe
      src={buildMapEmbedSrc(locale)}
      title={t("mapTitle")}
      loading="lazy"
      allowFullScreen
      referrerPolicy="no-referrer"
      className="h-72 w-full rounded-2xl border-0 sm:h-80"
    />
  );
}