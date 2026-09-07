"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CLINIC_IDENTITY } from "@/lib/settings/clinicIdentity";
import { PhoneIcon, StarIcon } from "../icons";
import HeroOrb from "./HeroOrb";

// Doctor-centric hero (home-ui Task 1): Dr Besma Moussaoui's name + promise
// left, her portrait right with one ambient fluid-orb accent behind it.
// Exactly four text elements (eyebrow, H1, subtext, CTAs) — proof lives in
// the frosted card over the portrait and in the proof bar below, never in
// the hero copy. No floaters, no parallax, no scroll cue, no gradient text.
const DOCTOR_NAME = "Dr Besma Moussaoui";

export default function HeroHome() {
  const t = useTranslations("Home");
  const telHref = `tel:${CLINIC_IDENTITY.phone.replace(/[\s-]/g, "")}`;

  return (
    <section className="relative overflow-hidden bg-white">
      {/* Calm spa wash (glass-over-aurora language, CodeFronts MIT): static CSS only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 end-0 h-96 w-96 rounded-full bg-teal-100/70 blur-3xl"
      />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:pb-24 lg:pt-20">
        <div className="max-w-xl">
          <p className="hero-enter text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
            {t("heroEyebrow")}
          </p>
          <h1
            style={{ animationDelay: "60ms" }}
            className="hero-enter mt-4 text-4xl font-bold tracking-tight text-zinc-900 md:text-5xl lg:text-6xl"
          >
            {DOCTOR_NAME}
          </h1>
          <p
            style={{ animationDelay: "140ms" }}
            className="hero-enter mt-4 max-w-[52ch] text-lg leading-relaxed text-zinc-600"
          >
            {t("heroSubtitle")}
          </p>
          <div
            style={{ animationDelay: "220ms" }}
            className="hero-enter mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Link
              href="/book"
              className="rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              {t("cta")}
            </Link>
            <a
              href={telHref}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-8 py-4 text-base font-semibold text-zinc-800 transition-all hover:-translate-y-0.5 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              <PhoneIcon width={18} height={18} aria-hidden />
              {t("heroCall")}
            </a>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[420px]">
          <HeroOrb className="-top-20 -end-10 sm:-top-24 sm:-end-20" />
          <Image
            src="/images/dr-moussaoui-portrait.png"
            alt={t("heroPortraitAlt")}
            width={768}
            height={1092}
            priority
            sizes="(max-width: 1024px) 100vw, 420px"
            className="relative h-auto w-full rounded-[1.75rem] object-cover shadow-xl ring-1 ring-zinc-900/10"
          />
          <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/60 bg-white/80 px-4 py-3 shadow-lg backdrop-blur">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
              <span className="flex text-amber-400" aria-hidden>
                <StarIcon width={16} height={16} fill="currentColor" stroke="none" />
              </span>
              {t("heroRating")}
            </p>
            <p className="mt-0.5 text-xs text-zinc-600">{CLINIC_IDENTITY.address}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
