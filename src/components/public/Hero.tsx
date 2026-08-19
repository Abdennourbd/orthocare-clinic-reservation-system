import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function Hero() {
  const t = useTranslations("Hero");
  const nav = useTranslations("Nav");
  return (
    <section className="bg-gradient-to-b from-teal-50 to-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-20 text-center sm:px-6 md:py-28">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">
          {t("title")}
        </h1>
        <p className="max-w-xl text-lg text-zinc-600">{t("subtitle")}</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/book"
            className="rounded-full bg-teal-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-teal-700"
          >
            {t("cta")}
          </Link>
          <Link
            href="/services"
            className="rounded-full border border-zinc-300 px-6 py-3 text-base font-semibold text-zinc-800 transition-colors hover:bg-zinc-100"
          >
            {t("secondaryCta")}
          </Link>
        </div>
        <p className="sr-only">{nav("home")}</p>
      </div>
    </section>
  );
}
