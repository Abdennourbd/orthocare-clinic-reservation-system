"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";

// Fear-killer (conversion Slice B): dental anxiety causes 22% of missed
// appointments, so the page answers it head-on — centered promise, three
// concrete reassurances, then a wide chair-side photo with a frosted
// caption card (glass-over-aurora language, CodeFronts hs-04, MIT).
// Deliberately NOT a split: hero and results already use that family.
export default function ComfortSection() {
  const t = useTranslations("Home");
  const points = [t("comfortP1"), t("comfortP2"), t("comfortP3")];

  return (
    <section className="bg-teal-50/60" aria-labelledby="comfort-title">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2
            id="comfort-title"
            className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
          >
            {t("comfortTitle")}
          </h2>
          <p className="mt-3 leading-relaxed text-zinc-600">{t("comfortDesc")}</p>
          <ul className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row sm:flex-wrap sm:gap-x-8">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-2 text-sm font-semibold text-teal-800">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                {p}
              </li>
            ))}
          </ul>
          <Link
            href="/book"
            className="mt-8 inline-block rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
          >
            {t("cta")}
          </Link>
        </Reveal>

        <Reveal delay={0.1} className="relative mx-auto mt-12 max-w-4xl">
          <Image
            src="/images/dr-treatment.jpg"
            alt={t("comfortPhotoAlt")}
            width={1024}
            height={722}
            loading="lazy"
            sizes="(max-width: 1024px) 100vw, 896px"
            className="h-auto w-full rounded-[1.75rem] object-cover shadow-xl ring-1 ring-zinc-900/10"
          />
          <p className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-center text-sm font-medium text-zinc-800 shadow-lg backdrop-blur sm:inset-x-auto sm:bottom-6 sm:start-6 sm:max-w-sm sm:text-start">
            {t("comfortPhotoCaption")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
