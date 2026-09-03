import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listActiveGalleryItems } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import { groupIntoBlocks } from "@/lib/public/galleryBlocks";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Reveal from "@/components/public/motion/Reveal";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "GalleryPage" });
  return pageMetadata(locale, "/gallery", t("title"), t("subtitle"));
}

export default async function GalleryPage() {
  const [t, locale] = await Promise.all([getTranslations("GalleryPage"), getAppLocale()]);
  const items = await listActiveGalleryItems(locale);
  const blocks = groupIntoBlocks(items);

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
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8 lg:grid-cols-3">
          {blocks.map((block, i) => {
            const delay = Math.min(i * 0.06, 0.36);

            if (block.type === "pair") {
              return (
                <Reveal
                  key={`${block.before.id}-${block.after.id}`}
                  delay={delay}
                  className="sm:col-span-2"
                >
                  <figure
                    tabIndex={0}
                    aria-label={t("comparisonLabel")}
                    className="group grid h-full grid-cols-2 gap-px overflow-hidden rounded-2xl border border-teal-200 bg-teal-100/60 shadow-sm outline-none transition-shadow duration-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                  >
                    <span className="col-span-2 bg-white px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-teal-700">
                      {t("comparisonLabel")}
                    </span>
                    <div className="relative overflow-hidden bg-white">
                      <span className="absolute start-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-teal-700 shadow-sm">
                        {t("beforeLabel")}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={block.before.imageUrl}
                        alt={block.before.caption || ""}
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <div className="relative overflow-hidden bg-white">
                      <span className="absolute start-2 top-2 rounded-full bg-teal-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
                        {t("afterLabel")}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={block.after.imageUrl}
                        alt={block.after.caption || ""}
                        loading="lazy"
                        className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    </div>
                    <figcaption className="col-span-2 space-y-1 border-t border-teal-100 bg-white px-4 py-3 text-sm text-zinc-600">
                      <p>{block.before.caption}</p>
                      <p>{block.after.caption}</p>
                    </figcaption>
                  </figure>
                </Reveal>
              );
            }

            return (
              <Reveal key={block.item.id} delay={delay} className="h-full">
                <figure
                  tabIndex={0}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm outline-none transition-shadow duration-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                >
                  <div className="overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={block.item.imageUrl}
                      alt={block.item.caption || ""}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  {block.item.caption && (
                    <figcaption className="border-t border-zinc-100 px-4 py-3 text-sm text-zinc-600">
                      {block.item.caption}
                    </figcaption>
                  )}
                </figure>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );
}
