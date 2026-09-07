"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";

// Who will touch my teeth (conversion Slice C): editorial quote band —
// small portrait, real patient words on kindness, credential chips. A
// blockquote family layout (CodeFronts bq patterns, MIT), deliberately
// different from the 50/50 splits above it.
export default function DoctorSection() {
  const t = useTranslations("Home");
  const creds = [t("doctorCred1"), t("doctorCred2"), t("doctorCred3")];

  return (
    <section className="bg-white" aria-labelledby="doctor-title">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <Reveal>
          <figure className="mx-auto max-w-4xl rounded-[1.75rem] border border-teal-100 bg-teal-50/50 p-6 sm:p-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <Image
                src="/images/dr-moussaoui-portrait.png"
                alt={t("heroPortraitAlt")}
                width={192}
                height={273}
                loading="lazy"
                sizes="192px"
                className="h-auto w-32 shrink-0 rounded-2xl object-cover shadow-md ring-1 ring-zinc-900/10 sm:w-40"
              />
              <div>
                <blockquote className="text-lg font-medium leading-relaxed text-zinc-800 sm:text-xl">
                  {t("doctorQuote")}
                </blockquote>
                <figcaption className="mt-3 text-sm font-semibold text-teal-800">
                  {t("doctorQuoteAuthor")}
                </figcaption>
              </div>
            </div>
            <div className="mt-6 flex flex-col gap-5 border-t border-teal-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p id="doctor-title" className="text-base font-bold text-zinc-900">
                  Dr Besma Moussaoui
                </p>
                <p className="mt-0.5 text-sm text-zinc-600">{t("doctorRole")}</p>
                <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("doctorRole")}>
                  {creds.map((c) => (
                    <li
                      key={c}
                      className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-teal-700 ring-1 ring-teal-200"
                    >
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <Link
                href="/about"
                className="shrink-0 rounded-full border border-teal-600 px-7 py-3 text-center text-base font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              >
                {t("doctorAboutCta")}
              </Link>
            </div>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
