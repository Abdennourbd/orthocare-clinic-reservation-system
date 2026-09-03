import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getActiveServiceBySlug, formatPrice } from "@/lib/public/services";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import Reveal from "@/components/public/motion/Reveal";
import { ToothIcon, ArrowRightIcon, ClockIcon } from "@/components/public/icons";

export const revalidate = 3600;

type Props = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "ServicesPage" });
  const service = await getActiveServiceBySlug(slug, locale);
  if (!service) return pageMetadata(locale, "/services", t("title"), t("subtitle"));
  return pageMetadata(
    locale,
    `/services/${slug}`,
    `${service.name} — ${t("title")}`,
    service.description
  );
}

export default async function ServiceDetailPage({ params }: Props) {
  const { locale, slug } = await params;
  const [t, service] = await Promise.all([
    getTranslations("ServicesPage"),
    getActiveServiceBySlug(slug, locale),
  ]);

  if (!service) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Reveal>
        <Link
          href="/services"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 hover:text-teal-700"
        >
          <ArrowRightIcon width={16} height={16} className="rotate-180 rtl:rotate-0" />
          {t("back")}
        </Link>

        <div className="mt-6 flex items-start gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600">
            <ToothIcon width={32} height={32} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              {service.name}
            </h1>
            <p className="mt-3 text-lg text-zinc-600">{service.description}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5">
            <ClockIcon width={24} height={24} className="text-teal-600" />
            <div>
              <p className="text-sm text-zinc-500">{t("durationLabel")}</p>
              <p className="font-semibold text-zinc-900">
                {t("duration", { minutes: service.durationMinutes })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5">
            <ToothIcon width={24} height={24} className="text-teal-600" />
            <div>
              <p className="text-sm text-zinc-500">{t("priceLabel")}</p>
              <p className="font-semibold text-zinc-900">
                {formatPrice(service.price, service.currency, t("free"), locale)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-10">
          <Link
            href="/book"
            className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700"
          >
            {t("book")}
            <ArrowRightIcon width={18} height={18} className="rtl:rotate-180" />
          </Link>
        </div>
      </Reveal>
    </div>
  );
}
