import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listActiveFaqItems } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Reveal from "@/components/public/motion/Reveal";
import FaqAccordion from "@/components/public/FaqAccordion";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "FaqPage" });
  return pageMetadata(locale, "/faq", t("title"), t("subtitle"));
}

export default async function FaqPage() {
  const [t, locale] = await Promise.all([getTranslations("FaqPage"), getAppLocale()]);
  const items = await listActiveFaqItems(locale);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Reveal className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">{t("subtitle")}</p>
      </Reveal>

      {items.length === 0 ? (
        <p className="mt-12 text-center text-zinc-600">{t("empty")}</p>
      ) : (
        <Reveal className="mt-12">
          <FaqAccordion items={items} />
        </Reveal>
      )}
    </div>
  );
}
