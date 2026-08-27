import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";
import { ToothIcon } from "../icons";

// Final full-width call-to-action band above the footer.
export default function CtaBand() {
  const t = useTranslations("Home");
  return (
    <section id="book" className="relative overflow-hidden bg-teal-600">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-teal-500/40 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-emerald-400/30 blur-3xl"
      />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 py-20 text-center sm:px-6">
        <Reveal>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15 text-white">
            <ToothIcon width={32} height={32} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {t("ctaTitle")}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-teal-50">
            {t("ctaSubtitle")}
          </p>
          <Link
            href="/book"
            className="mt-8 inline-block rounded-full bg-white px-8 py-4 text-base font-semibold text-teal-700 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-teal-50"
          >
            {t("ctaButton")}
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
