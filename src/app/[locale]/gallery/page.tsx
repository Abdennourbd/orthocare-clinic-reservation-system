import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listActiveGalleryItems } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "@/components/public/motion/Reveal";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("GalleryPage");
  return { title: t("title"), description: t("subtitle") };
}

export default async function GalleryPage() {
  const [t, locale] = await Promise.all([getTranslations("GalleryPage"), getAppLocale()]);
  const items = await listActiveGalleryItems(locale);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Reveal className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">{t("subtitle")}</p>
      </Reveal>

      {items.length === 0 ? (
        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-dashed border-zinc-300 p-10 text-center">
          <p className="text-lg font-semibold text-zinc-700">{t("emptyTitle")}</p>
          <p className="mt-2 text-sm text-zinc-500">{t("empty")}</p>
        </div>
      ) : (
        <div className="mt-12 columns-1 gap-4 sm:columns-2 lg:columns-3">
          {items.map((item, i) => (
            <Reveal key={item.id} delay={i * 0.04} className="mb-4 break-inside-avoid">
              <figure className="overflow-hidden rounded-2xl border border-zinc-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageUrl}
                  alt={item.caption || ""}
                  loading="lazy"
                  className="w-full object-cover"
                />
                {item.caption && (
                  <figcaption className="bg-white px-4 py-3 text-sm text-zinc-600">
                    {item.caption}
                  </figcaption>
                )}
              </figure>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
