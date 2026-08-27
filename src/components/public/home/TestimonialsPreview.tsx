import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listActiveTestimonials } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "../motion/Reveal";
import Marquee from "../motion/Marquee";
import { StarIcon } from "../icons";

export default async function TestimonialsPreview() {
  const [t, locale] = await Promise.all([getTranslations("Home"), getAppLocale()]);
  const items = await listActiveTestimonials(locale);

  if (items.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="testimonials-title">
      <Reveal className="text-center">
        <h2 id="testimonials-title" className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          {t("testimonialsTitle")}
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600">{t("testimonialsSubtitle")}</p>
      </Reveal>

      <Reveal className="mt-12">
        <Marquee speed={40} className="gap-4">
          {items.map((item) => (
            <figure
              key={item.id}
              className="w-80 shrink-0 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <div className="flex text-amber-400" aria-label={`${item.rating}/5`}>
                {Array.from({ length: item.rating }).map((_, i) => (
                  <StarIcon key={i} width={16} height={16} fill="currentColor" stroke="none" />
                ))}
              </div>
              <blockquote className="mt-3 text-sm text-zinc-600">{item.content}</blockquote>
              <figcaption className="mt-4 text-sm font-semibold text-zinc-900">
                — {item.author}
              </figcaption>
            </figure>
          ))}
        </Marquee>
      </Reveal>

      <Reveal className="mt-10 text-center">
        <Link
          href="/testimonials"
          className="inline-flex items-center gap-2 rounded-full border border-teal-600 px-7 py-3 text-base font-semibold text-teal-700 transition-colors hover:bg-teal-50"
        >
          {t("testimonialsViewAll")}
        </Link>
      </Reveal>
    </section>
  );
}
