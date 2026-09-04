import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listActiveGalleryItems } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "../motion/Reveal";

export default async function GalleryPreview() {
  const [t, locale] = await Promise.all([getTranslations("Home"), getAppLocale()]);
  const items = (await listActiveGalleryItems(locale)).slice(0, 6);

  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="gallery-title">
      <Reveal className="text-center">
        <h2 id="gallery-title" className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          {t("galleryTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600">{t("gallerySubtitle")}</p>
      </Reveal>

      <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
        {items.map((item, i) => (
          <Reveal key={item.id} delay={i * 0.05}>
            <figure className="group relative aspect-square overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
              <Image
                src={item.imageUrl}
                alt={item.caption || ""}
                fill
                loading="lazy"
                sizes="(max-width: 640px) 50vw, 33vw"
                className="object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {item.caption && (
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pb-3 pt-8 text-sm text-white">
                  {item.caption}
                </figcaption>
              )}
            </figure>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-10 text-center">
        <Link
          href="/gallery"
          className="inline-flex items-center gap-2 rounded-full border border-teal-600 px-7 py-3 text-base font-semibold text-teal-700 transition-colors hover:bg-teal-50"
        >
          {t("galleryViewAll")}
        </Link>
      </Reveal>
    </section>
  );
}
