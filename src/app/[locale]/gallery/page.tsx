import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listActiveSmileCases } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Reveal from "@/components/public/motion/Reveal";
import BeforeAfterSlider from "@/components/public/BeforeAfterSlider";

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
  const cases = await listActiveSmileCases(locale);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Reveal className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">{t("subtitle")}</p>
      </Reveal>

      {cases.length === 0 ? (
        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-dashed border-zinc-300 p-10 text-center">
          <p className="text-lg font-semibold text-zinc-700">{t("emptyTitle")}</p>
          <p className="mt-2 text-sm text-zinc-500">{t("empty")}</p>
        </div>
      ) : (
        <>
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-8">
            {cases.map((c, i) => (
              <Reveal key={c.id} delay={Math.min(i * 0.06, 0.36)} className="h-full">
                <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-shadow duration-300 hover:shadow-md">
                  <BeforeAfterSlider
                    beforeSrc={c.beforeImageUrl}
                    afterSrc={c.afterImageUrl}
                    beforeAlt={`${c.title} — ${t("beforeLabel")}`}
                    afterAlt={`${c.title} — ${t("afterLabel")}`}
                    beforeLabel={t("beforeLabel")}
                    afterLabel={t("afterLabel")}
                    sliderLabel={`${c.title} — ${t("comparisonLabel")}`}
                    sizes="(max-width: 640px) 100vw, 50vw"
                  />
                  <div className="flex flex-1 flex-col gap-2 border-t border-zinc-100 px-5 py-4">
                    <h2 className="text-lg font-semibold text-zinc-900">{c.title}</h2>
                    {c.description ? (
                      <p className="line-clamp-3 text-sm text-zinc-600">{c.description}</p>
                    ) : null}
                    <Link
                      href={`/gallery/${c.key}`}
                      className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-teal-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
                    >
                      {t("viewCase")} →
                    </Link>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-14">
            <div className="rounded-2xl border border-teal-200 bg-teal-50/60 px-6 py-10 text-center sm:px-12">
              <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{t("ctaTitle")}</h2>
              <p className="mx-auto mt-3 max-w-2xl text-zinc-600">{t("ctaText")}</p>
              <Link
                href="/book"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-teal-700 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
              >
                {t("ctaButton")}
              </Link>
            </div>
          </Reveal>
        </>
      )}
    </div>
  );
}
