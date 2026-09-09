"use client";

import { useTranslations } from "next-intl";
import { useRef } from "react";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";
import BeforeAfterSlider from "../BeforeAfterSlider";
import { StarIcon, ArrowRightIcon } from "../icons";
import type { PublicHomeSmileCase } from "@/lib/public/content";

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

export default function SmileResults({ cases = [] }: { cases?: PublicHomeSmileCase[] }) {
  const t = useTranslations("Home");
  const tGallery = useTranslations("GalleryPage");
  const railRef = useRef<HTMLDivElement>(null);

  const scrollRail = (dir: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const smooth =
      typeof window !== "undefined" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollBy({ left: dir * rail.clientWidth * 0.85, behavior: smooth ? "smooth" : "auto" });
  };

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

      {cases.length > 0 ? (
        <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 md:pb-20">
          <Reveal className="text-center">
            <h3 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
              {t("galleryTitle")}
            </h3>
            <p className="mx-auto mt-2 max-w-2xl text-zinc-600">{t("gallerySubtitle")}</p>
          </Reveal>

          <div className="mt-6 flex justify-center gap-3 sm:hidden">
            <button
              type="button"
              onClick={() => scrollRail(-1)}
              aria-label={t("casesPrev")}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              <ArrowRightIcon width={18} height={18} className="rotate-180 rtl:rotate-0" />
            </button>
            <button
              type="button"
              onClick={() => scrollRail(1)}
              aria-label={t("casesNext")}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              <ArrowRightIcon width={18} height={18} className="rtl:rotate-180" />
            </button>
          </div>

          <div
            ref={railRef}
            role="region"
            aria-roledescription="carousel"
            aria-label={t("galleryTitle")}
            className="cases-rail mt-8 flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0"
          >
            {cases.map((c, i) => (
              <Reveal
                key={c.id}
                delay={Math.min(i * 0.05, 0.2)}
                className="h-full w-[85vw] shrink-0 snap-center sm:w-auto"
              >
                <article className="wipe-frame flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  <div className="wipe-media">
                    <BeforeAfterSlider
                      beforeSrc={c.beforeImageUrl}
                      afterSrc={c.afterImageUrl}
                      beforeAlt={`${c.title} — ${tGallery("beforeLabel")}`}
                      afterAlt={`${c.title} — ${tGallery("afterLabel")}`}
                      beforeLabel={tGallery("beforeLabel")}
                      afterLabel={tGallery("afterLabel")}
                      sliderLabel={`${c.title} — ${tGallery("comparisonLabel")}`}
                      sizes="(max-width: 640px) 85vw, 50vw"
                    />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <h4 className="text-lg font-bold tracking-tight text-zinc-900">{c.title}</h4>
                    {c.description ? (
                      <p className="mt-2 line-clamp-2 leading-relaxed text-zinc-600">{c.description}</p>
                    ) : null}
                    {c.images.length > 0 ? (
                      <div
                        className="cases-extras mt-4 flex gap-2 overflow-x-auto pb-1"
                        role="list"
                        aria-label={c.title}
                      >
                        {c.images.map((img) => (
                          <div
                            key={img.id}
                            role="listitem"
                            className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100"
                          >
                            <Image
                              src={img.imageUrl}
                              alt={img.caption || c.title}
                              fill
                              loading="lazy"
                              sizes="96px"
                              className="object-cover"
                            />
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <Link
                      href={`/gallery/${c.key}`}
                      aria-label={`${c.title} — ${tGallery("viewCase")}`}
                      className="mt-4 inline-flex items-center gap-1.5 text-base font-semibold text-teal-700 underline-offset-4 transition-colors hover:text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
                    >
                      {tGallery("viewCase")}
                    </Link>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-8 text-center">
            <Link
              href="/gallery"
              className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              {t("galleryCtaButton")}
            </Link>
          </Reveal>
        </div>
      ) : null}
    </section>
  );
}
