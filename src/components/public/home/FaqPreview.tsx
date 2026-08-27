import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { listActiveFaqItems } from "@/lib/public/content";
import { getAppLocale } from "@/lib/i18n/getLocale";
import Reveal from "../motion/Reveal";
import FaqAccordion from "../FaqAccordion";

export default async function FaqPreview() {
  const [t, locale] = await Promise.all([getTranslations("Home"), getAppLocale()]);
  const items = (await listActiveFaqItems(locale)).slice(0, 4);

  if (items.length === 0) return null;

  return (
    <section className="bg-teal-50/60">
      <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            {t("faqTitle")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-zinc-600">{t("faqSubtitle")}</p>
        </Reveal>

        <Reveal className="mt-10">
          <FaqAccordion items={items} />
        </Reveal>

        <Reveal className="mt-10 text-center">
          <Link
            href="/faq"
            className="inline-flex items-center gap-2 rounded-full border border-teal-600 px-7 py-3 text-base font-semibold text-teal-700 transition-colors hover:bg-teal-50"
          >
            {t("faqViewAll")}
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
