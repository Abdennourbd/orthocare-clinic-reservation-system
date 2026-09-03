import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Reveal from "@/components/public/motion/Reveal";
import { ToothIcon, HeartIcon, ShieldIcon, SparkleIcon } from "@/components/public/icons";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  return pageMetadata(locale, "/about", t("title"), t("subtitle"));
}

export default async function AboutPage() {
  const t = await getTranslations("About");
  const values = [
    { Icon: HeartIcon, title: t("values.care.title"), desc: t("values.care.desc") },
    { Icon: ShieldIcon, title: t("values.safety.title"), desc: t("values.safety.desc") },
    { Icon: SparkleIcon, title: t("values.quality.title"), desc: t("values.quality.desc") },
  ] as const;

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <Reveal className="text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
          <ToothIcon width={32} height={32} />
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">{t("subtitle")}</p>
      </Reveal>

      <Reveal className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{t("storyTitle")}</h2>
        <div className="mt-4 space-y-4 text-zinc-600">
          <p>{t("story1")}</p>
          <p>{t("story2")}</p>
        </div>
      </Reveal>

      <Reveal className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900">{t("valuesTitle")}</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {values.map(({ Icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-600 text-white">
                <Icon width={24} height={24} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-zinc-900">{title}</h3>
              <p className="mt-2 text-sm text-zinc-600">{desc}</p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="mt-12 text-center">
        <Link
          href="/book"
          className="inline-block rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700"
        >
          {t("cta")}
        </Link>
      </Reveal>
    </div>
  );
}
