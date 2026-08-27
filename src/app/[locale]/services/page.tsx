import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listActiveServices, formatPrice } from "@/lib/public/services";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "@/components/public/motion/Reveal";
import { ToothIcon, ArrowRightIcon } from "@/components/public/icons";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ServicesPage");
  return { title: t("title"), description: t("subtitle") };
}

export default async function ServicesPage() {
  const [t, locale] = await Promise.all([getTranslations("ServicesPage"), getAppLocale()]);
  const services = await listActiveServices(locale);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Reveal className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">{t("subtitle")}</p>
      </Reveal>

      {services.length === 0 ? (
        <p className="mt-12 text-center text-zinc-600">{t("empty")}</p>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((s, i) => (
            <Reveal key={s.id} delay={i * 0.05}>
              <Link
                href={`/services/${s.slug}`}
                className="group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-teal-200 hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                  <ToothIcon width={24} height={24} />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-zinc-900">{s.name}</h2>
                <p className="mt-2 flex-1 text-sm text-zinc-600">{s.description}</p>
                <div className="mt-4 flex items-center justify-between text-sm">
                  <span className="font-medium text-teal-700">
                    {formatPrice(s.price, s.currency, t("free"), locale)}
                  </span>
                  <span className="text-zinc-400">{t("duration", { minutes: s.durationMinutes })}</span>
                </div>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600">
                  {t("details")}
                  <ArrowRightIcon width={16} height={16} className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
