import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listActiveSmileCases, listFeaturedSmileCases } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "../motion/Reveal";

// Home preview of the patient-case gallery: the admin's featured picks
// (fallback: latest active cases when none featured yet). After-image cards
// link to the case detail; the CTA button leads to the full gallery.

export default async function GalleryPreview() {
  const [t, tGallery, locale] = await Promise.all([
    getTranslations("Home"),
    getTranslations("GalleryPage"),
    getAppLocale(),
  ]);
  const featured = await listFeaturedSmileCases(locale);
  const items = (featured.length > 0 ? featured : await listActiveSmileCases(locale)).slice(0, 4);

  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="gallery-title">
      <Reveal className="text-center">
        <h2 id="gallery-title" className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          {t("galleryTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600">{t("gallerySubtitle")}</p>
      </Reveal>

      <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        {items.map((item, i) => (
          <Reveal key={item.id} delay={i * 0.05} className="h-full">
            <Link
              href={`/gallery/${item.key}`}
              className="group relative block aspect-[3/4] h-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow duration-300 outline-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
              aria-label={`${item.title} — ${tGallery("viewCase")}`}
            >
              <Image
                src={item.afterImageUrl}
                alt={item.title}
                fill
                loading="lazy"
                sizes="(max-width: 640px) 50vw, 25vw"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10 text-sm font-medium text-white">
                {item.title}
              </span>
            </Link>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-10 text-center">
        <Link
          href="/gallery"
          className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          {t("galleryCtaButton")}
        </Link>
      </Reveal>
    </section>
  );
}
