"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";

// First-visit story (clinic revamp): three alternating moments — arrive
// somewhere calm, met by a smiling team, treated with modern tools. Each
// pairs one real clinic photo (band-photo parallax kept) with one
// patient-benefit line, closing with Book + About CTAs. Flat zinc-50 band
// so the section stops blending into its white neighbors (game above,
// testimonials below); alternating rows exist nowhere else on the page.
export default function ClinicSection() {
  const t = useTranslations("Home");
  const moments = [
    {
      n: "01",
      src: "/images/clinic-waiting-room.jpg",
      alt: t("clinicCap1"),
      title: t("clinicStep1Title"),
      desc: t("clinicStep1Desc"),
      w: 1600,
      h: 1067,
    },
    {
      n: "02",
      src: "/images/clinic-reception.jpg",
      alt: t("clinicCap2"),
      title: t("clinicStep2Title"),
      desc: t("clinicStep2Desc"),
      w: 1024,
      h: 843,
    },
    {
      n: "03",
      src: "/images/clinic-equipment.jpg",
      alt: t("clinicCap3"),
      title: t("clinicStep3Title"),
      desc: t("clinicStep3Desc"),
      w: 1600,
      h: 1561,
    },
  ];

  return (
    <section className="bg-zinc-50" aria-labelledby="clinic-title">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <Reveal className="max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-teal-600">
            {t("clinicEyebrow")}
          </p>
          <h2
            id="clinic-title"
            className="mt-3 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
          >
            {t("clinicTitle")}
          </h2>
          <p className="mt-3 leading-relaxed text-zinc-600">{t("clinicDesc")}</p>
        </Reveal>

        <div className="mt-12 space-y-12 md:space-y-16">
          {moments.map((m, i) => (
            <div key={m.src} className="grid items-center gap-6 md:grid-cols-2 md:gap-10">
              <Reveal className={i % 2 === 1 ? "md:order-2" : undefined}>
                <div className="band-frame aspect-[4/3] overflow-hidden rounded-[1.75rem] bg-zinc-200 shadow-lg ring-1 ring-zinc-900/10">
                  <Image
                    src={m.src}
                    alt={m.alt}
                    width={m.w}
                    height={m.h}
                    loading="lazy"
                    sizes="(max-width: 768px) 100vw, 50vw"
                    className="band-photo h-full w-full object-cover"
                  />
                </div>
              </Reveal>
              <Reveal delay={0.08} className={i % 2 === 1 ? "md:order-1" : undefined}>
                <p
                  aria-hidden
                  className="text-sm font-bold tracking-[0.2em] text-teal-600"
                >
                  {m.n}
                </p>
                <h3 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900">
                  {m.title}
                </h3>
                <p className="mt-2 max-w-[52ch] leading-relaxed text-zinc-600">{m.desc}</p>
              </Reveal>
            </div>
          ))}
        </div>

        <Reveal className="mt-12 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/book"
            className="block w-full rounded-full bg-teal-600 px-8 py-4 text-center text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 sm:inline-block sm:w-auto"
          >
            {t("cta")}
          </Link>
          <Link
            href="/about"
            className="block w-full rounded-full border border-teal-600 px-8 py-4 text-center text-base font-semibold text-teal-700 transition-colors hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 sm:inline-block sm:w-auto"
          >
            {t("doctorAboutCta")}
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
