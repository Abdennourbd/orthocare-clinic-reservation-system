"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";
import BeforeAfterSlider from "../BeforeAfterSlider";
import { StarIcon } from "../icons";

// Real smile transformation (conversion Slice B): the vendored before/after
// photos inside our accessible BeforeAfterSlider (pointer + keyboard,
// RTL-isolated — the same mechanics as CodeFronts' hs-09 range-slider
// pattern, MIT). Answers the patient's first question: will it work for me?
// Star-pill badge language adapted from CodeFronts hs-07 (MIT).
export default function SmileResults() {
  const t = useTranslations("Home");
  const tGallery = useTranslations("GalleryPage");

  return (
    <section className="bg-white" aria-labelledby="results-title">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-2">
        <Reveal>
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[13px] font-bold tracking-wide text-zinc-700 ring-1 ring-amber-200">
            <span className="flex text-amber-400" aria-hidden>
              <StarIcon width={14} height={14} fill="currentColor" stroke="none" />
            </span>
            {t("resultsBadge")}
          </p>
          <h2
            id="results-title"
            className="mt-4 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
          >
            {t("resultsTitle")}
          </h2>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-zinc-600">{t("resultsDesc")}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/book"
              className="rounded-full bg-teal-600 px-8 py-4 text-center text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              {t("cta")}
            </Link>
            <Link
              href="/gallery"
              className="text-center text-base font-semibold text-teal-700 underline-offset-4 transition-colors hover:text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              {t("resultsGalleryCta")}
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <BeforeAfterSlider
            beforeSrc="/images/smile-before.jpg"
            afterSrc="/images/smile-after.jpg"
            beforeAlt={t("resultsBeforeAlt")}
            afterAlt={t("resultsAfterAlt")}
            beforeLabel={tGallery("beforeLabel")}
            afterLabel={tGallery("afterLabel")}
            sliderLabel={tGallery("sliderHint")}
            sizes="(max-width: 1024px) 100vw, 560px"
          />
          <p className="mt-3 text-sm text-zinc-500">{t("resultsCaption")}</p>
        </Reveal>
      </div>
    </section>
  );
}
