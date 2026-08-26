import { getTranslations } from "next-intl/server";
import { buildPlaceUrl, buildReviewsEmbedSrc } from "@/lib/maps/embed";
import { getAppLocale } from "@/lib/i18n/getLocale";

// Google Reviews widget (Task 10): the free no-key "place card" embed which
// renders the clinic's LIVE Google rating + review count and a link to the
// full reviews. It does not render the individual review list (that needs the
// Places API; see tasks/plan.md). A visible fallback link keeps the section
// useful even if the iframe is blocked by the visitor's network.
export default async function GoogleReviews() {
  const [locale, t] = await Promise.all([
    getAppLocale(),
    getTranslations("Reviews"),
  ]);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <iframe
        src={buildReviewsEmbedSrc(locale)}
        title={t("widgetTitle")}
        loading="lazy"
        allowFullScreen
        referrerPolicy="no-referrer"
        className="h-80 w-full border-0 sm:h-96 md:h-[26rem]"
      />
      <a
        href={buildPlaceUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1 border-t border-zinc-200 px-4 py-3 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-50"
      >
        {t("seeAll")}
      </a>
    </div>
  );
}