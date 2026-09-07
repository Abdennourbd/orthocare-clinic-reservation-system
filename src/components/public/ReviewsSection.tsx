import { getTranslations } from "next-intl/server";
import { buildPlaceUrl } from "@/lib/maps/embed";
import Reveal from "./motion/Reveal";
import { StarIcon } from "./icons";

// Closing proof (conversion fix 2026-09-07): the old free-embed iframe
// rendered a second MAP under a "reviews" heading — a duplicate of the
// location map and zero social proof. Replaced with a designed rating card
// linking to the live Google listing (a live per-review list still needs
// the Places API; see tasks/plan.md).
export default async function ReviewsSection() {
  const t = await getTranslations("Reviews");
  return (
    <section className="bg-white" aria-labelledby="reviews-title">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <Reveal className="mx-auto max-w-3xl rounded-[1.75rem] border border-zinc-200 bg-zinc-50/60 px-6 py-10 text-center sm:px-10">
          <p
            className="inline-flex items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-amber-400 ring-1 ring-amber-200"
            aria-label={t("count")}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <StarIcon key={i} width={16} height={16} fill="currentColor" stroke="none" aria-hidden />
            ))}
          </p>
          <h2
            id="reviews-title"
            className="mt-5 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
          >
            {t("title")}
          </h2>
          <p className="mt-4 text-6xl font-bold tracking-tight text-zinc-900" aria-hidden>
            {t("score")}
          </p>
          <p className="mt-2 text-sm font-semibold text-zinc-600">{t("count")}</p>
          <p className="mx-auto mt-3 max-w-xl text-zinc-600">{t("subtitle")}</p>
          <a
            href={buildPlaceUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-teal-600 px-7 py-3 text-base font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            {t("seeAll")}
          </a>
        </Reveal>
      </div>
    </section>
  );
}
