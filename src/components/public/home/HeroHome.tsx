import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Reveal from "../motion/Reveal";

export default function HeroHome() {
  const t = useTranslations("Home");
  return (
    <section className="bg-gradient-to-b from-teal-50 to-white py-20 text-center">
      <Reveal>
        <h1 className="text-5xl font-bold text-teal-900">{t("heroTitle")}</h1>
        <Link href="/book" className="mt-6 inline-block rounded-full bg-teal-600 px-6 py-3 text-white transition-colors hover:bg-teal-700">
          {t("cta")}
        </Link>
      </Reveal>
    </section>
  );
}
