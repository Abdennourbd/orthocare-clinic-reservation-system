"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import Reveal from "../motion/Reveal";

// Hygiene proof (conversion Slice C): the three things anxious patients
// scan for — waiting room, welcome, equipment — as a captioned photo grid.
// Captions echo the patients' own words ("propre, moderne et bien
// organisée", real t3 quote). Pure photo grid family, no cards-with-icons.
export default function ClinicSection() {
  const t = useTranslations("Home");
  const photos = [
    {
      src: "/images/clinic-waiting-room.jpg",
      caption: t("clinicCap1"),
      w: 1600,
      h: 1067,
    },
    {
      src: "/images/clinic-reception.jpg",
      caption: t("clinicCap2"),
      w: 1024,
      h: 843,
    },
    {
      src: "/images/clinic-equipment.jpg",
      caption: t("clinicCap3"),
      w: 1600,
      h: 1561,
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20" aria-labelledby="clinic-title">
      <Reveal className="max-w-2xl">
        <h2
          id="clinic-title"
          className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl"
        >
          {t("clinicTitle")}
        </h2>
        <p className="mt-3 leading-relaxed text-zinc-600">{t("clinicDesc")}</p>
      </Reveal>

      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {photos.map((p, i) => (
          <Reveal key={p.src} delay={i * 0.07}>
            <figure className="group overflow-hidden rounded-2xl bg-zinc-100 shadow-sm ring-1 ring-zinc-900/10">
              <Image
                src={p.src}
                alt={p.caption}
                width={p.w}
                height={p.h}
                loading="lazy"
                sizes="(max-width: 640px) 100vw, 33vw"
                className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <figcaption className="bg-white px-4 py-3 text-sm font-semibold text-zinc-800">
                {p.caption}
              </figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
