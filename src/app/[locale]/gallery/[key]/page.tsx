import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSmileCaseByKey } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Reveal from "@/components/public/motion/Reveal";
import BeforeAfterSlider from "@/components/public/BeforeAfterSlider";
import { ArrowRightIcon } from "@/components/public/icons";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; key: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, key } = await params;
  const t = await getTranslations({ locale, namespace: "CasePage" });
  const c = await getSmileCaseByKey(key, locale);
  if (!c) return pageMetadata(locale, "/gallery", t("notFoundTitle"), t("notFoundText"));
  return pageMetadata(locale, `/gallery/${c.key}`, c.title, c.description);
}

export default async function CaseDetailPage({ params }: Props) {
  const { key } = await params;
  const [t, tGallery, locale] = await Promise.all([
    getTranslations("CasePage"),
    getTranslations("GalleryPage"),
    getAppLocale(),
  ]);
  const c = await getSmileCaseByKey(key, locale);

  if (!c) notFound();

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <Reveal>
        <Link
          href="/gallery"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          <ArrowRightIcon width={16} height={16} className="rotate-180 rtl:rotate-0" />
          {t("backToGallery")}
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          {c.title}
        </h1>
      </Reveal>

      <Reveal delay={0.08} className="mt-8">
        <BeforeAfterSlider
          beforeSrc={c.beforeImageUrl}
          afterSrc={c.afterImageUrl}
          beforeAlt={`${c.title} — ${tGallery("beforeLabel")}`}
          afterAlt={`${c.title} — ${tGallery("afterLabel")}`}
          beforeLabel={tGallery("beforeLabel")}
          afterLabel={tGallery("afterLabel")}
          sliderLabel={`${c.title} — ${tGallery("comparisonLabel")}`}
          sizes="(max-width: 768px) 100vw, 896px"
        />
        <p className="mt-2 text-center text-xs text-zinc-500">{tGallery("sliderHint")}</p>
      </Reveal>

      {c.description ? (
        <Reveal delay={0.12} className="mt-8">
          <p className="whitespace-pre-line text-lg leading-relaxed text-zinc-700">{c.description}</p>
        </Reveal>
      ) : null}

      {c.images.length > 0 ? (
        <section aria-labelledby="case-extras-title" className="mt-12">
          <Reveal>
            <h2 id="case-extras-title" className="text-2xl font-bold tracking-tight text-zinc-900">
              {t("extrasTitle")}
            </h2>
          </Reveal>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {c.images.map((img, i) => (
              <Reveal key={img.id} delay={Math.min(i * 0.05, 0.3)} className="h-full">
                <figure className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
                  <div className="relative aspect-square overflow-hidden">
                    <Image
                      src={img.imageUrl}
                      alt={img.caption || c.title}
                      fill
                      loading="lazy"
                      sizes="(max-width: 640px) 50vw, 33vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  {img.caption ? (
                    <figcaption className="border-t border-zinc-100 px-3 py-2 text-sm text-zinc-600">
                      {img.caption}
                    </figcaption>
                  ) : null}
                </figure>
              </Reveal>
            ))}
          </div>
        </section>
      ) : null}

      <Reveal className="mt-12 text-center">
        <Link
          href="/book"
          className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
        >
          {tGallery("ctaButton")}
        </Link>
      </Reveal>
    </div>
  );
}
