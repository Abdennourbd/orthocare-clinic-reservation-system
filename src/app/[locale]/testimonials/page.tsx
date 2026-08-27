import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listActiveTestimonials } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "@/components/public/motion/Reveal";
import { StarIcon } from "@/components/public/icons";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("TestimonialsPage");
  return { title: t("title"), description: t("subtitle") };
}

export default async function TestimonialsPage() {
  const [t, locale] = await Promise.all([
    getTranslations("TestimonialsPage"),
    getAppLocale(),
  ]);
  const items = await listActiveTestimonials(locale);

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <Reveal className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">{t("subtitle")}</p>
      </Reveal>

      {items.length === 0 ? (
        <p className="mt-12 text-center text-zinc-600">{t("empty")}</p>
      ) : (
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => (
            <Reveal key={item.id} delay={i * 0.05}>
              <figure className="h-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
                <div className="flex text-amber-400" aria-label={`${item.rating}/5`}>
                  {Array.from({ length: item.rating }).map((_, j) => (
                    <StarIcon key={j} width={16} height={16} fill="currentColor" stroke="none" />
                  ))}
                </div>
                <blockquote className="mt-3 text-sm text-zinc-600">{item.content}</blockquote>
                <figcaption className="mt-4 text-sm font-semibold text-zinc-900">
                  — {item.author}
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
