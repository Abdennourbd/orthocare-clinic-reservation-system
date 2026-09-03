import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listActiveServices, formatPrice } from "@/lib/public/services";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "../motion/Reveal";
import FloatCard from "../motion/FloatCard";
import { ToothIcon, ArrowRightIcon } from "../icons";

export default async function ServicesPreview() {
  const [t, locale] = await Promise.all([
    getTranslations("Home"),
    getAppLocale(),
  ]);
  const services = (await listActiveServices(locale)).slice(0, 6);

  // Like GalleryPreview/FaqPreview/TestimonialsPreview: render nothing when
  // there is no content rather than a hollow section with a dead link.
  if (services.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="services-title">
      <Reveal className="text-center">
        <h2 id="services-title" className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          {t("servicesTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600">{t("servicesSubtitle")}</p>
      </Reveal>

      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((s, i) => (
          <Reveal key={s.id} delay={i * 0.06}>
            <FloatCard className="group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm transition-colors hover:border-teal-200">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
                <ToothIcon width={24} height={24} />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-zinc-900">{s.name}</h3>
              <p className="mt-2 flex-1 text-sm text-zinc-600">{s.description}</p>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="font-medium text-teal-700">
                  {formatPrice(s.price, s.currency, t("servicesFree"), locale)}
                </span>
                <span className="text-zinc-400">{t("servicesDuration", { minutes: s.durationMinutes })}</span>
              </div>
              <Link
                href={`/services/${s.slug}`}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal-600 transition-colors hover:text-teal-700"
              >
                {t("servicesLearnMore")}
                <ArrowRightIcon width={16} height={16} className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
              </Link>
            </FloatCard>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-12 text-center">
        <Link
          href="/services"
          className="inline-flex items-center gap-2 rounded-full border border-teal-600 px-7 py-3 text-base font-semibold text-teal-700 transition-colors hover:bg-teal-50"
        >
          {t("servicesViewAll")}
          <ArrowRightIcon width={18} height={18} className="rtl:rotate-180" />
        </Link>
      </Reveal>
    </section>
  );
}
