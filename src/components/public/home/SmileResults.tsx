"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";
import BeforeAfterSlider from "../BeforeAfterSlider";
import { StarIcon } from "../icons";

// Pinned transformation chapter (scroll-journey Task 3): on lg screens the
// slider sticks (top-28, self-start) while three copy beats scroll past —
// badge/title/desc → caption/gallery link → book CTA — then releases into
// ComfortSection. Pure CSS sticky (layout, not animation): no JS measuring,
// space reserved by construction, vertical-only so RTL flips safely.
// Mobile stacks statically (copy, then slider) — pinning 390px is cramped.
const BEAT = "lg:flex lg:min-h-[70vh] lg:flex-col lg:justify-center";

function BeatNumeral({ n }: { n: string }) {
  return (
    <p aria-hidden className="mb-4 text-sm font-bold tracking-[0.2em] text-teal-600">
      {n}
    </p>
  );
}

export default function SmileResults() {
  const t = useTranslations("Home");
  const tGallery = useTranslations("GalleryPage");

  return (
    <section className="bg-white" aria-labelledby="results-title">
      <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-16 sm:px-6 md:py-20 lg:grid-cols-2">
        <div>
          <Reveal className={BEAT}>
            <BeatNumeral n="01" />
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
          </Reveal>

          <Reveal className={`${BEAT} mt-10 lg:mt-0`}>
            <BeatNumeral n="02" />
            <p className="max-w-[52ch] text-lg font-medium leading-relaxed text-zinc-800">
              {t("resultsCaption")}
            </p>
            <Link
              href="/gallery"
              className="mt-4 block text-base font-semibold text-teal-700 underline-offset-4 transition-colors hover:text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 sm:inline-block lg:self-start"
            >
              {t("resultsGalleryCta")}
            </Link>
            <Link
              href="/book"
              className="mt-6 block rounded-full bg-teal-600 px-8 py-4 text-center text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 sm:inline-block lg:self-start"
            >
              {t("cta")}
            </Link>
          </Reveal>
        </div>

        <div className="lg:sticky lg:top-28 lg:self-start">
          <Reveal>
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
          </Reveal>
        </div>
      </div>
    </section>
  );
}
