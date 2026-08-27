import { useTranslations } from "next-intl";
import Reveal from "../motion/Reveal";
import FloatCard from "../motion/FloatCard";

// Floating stat cards shown right below the hero. Numbers are clinic stats;
// labels come from the `Home.Stats` i18n namespace.
export default function TrustStrip() {
  const t = useTranslations("Home.Stats");
  const stats = [
    { value: "10+", label: t("years") },
    { value: "5000+", label: t("patients") },
    { value: "4.9★", label: t("rating") },
    { value: "98%", label: t("satisfaction") },
  ] as const;

  return (
    <section aria-label="Clinic statistics" className="relative -mt-10 px-4">
      <div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08}>
            <FloatCard className="rounded-2xl border border-teal-100 bg-white p-6 text-center shadow-sm">
              <p className="text-3xl font-extrabold text-teal-600 sm:text-4xl">
                {s.value}
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-500">{s.label}</p>
            </FloatCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
