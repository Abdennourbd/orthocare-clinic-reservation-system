import { useTranslations } from "next-intl";
import Reveal from "../motion/Reveal";
import FloatCard from "../motion/FloatCard";
import { HeartIcon, ShieldIcon, UsersIcon, CalendarIcon } from "../icons";

// "Why choose us" — a small grid of value props. Icon + title + blurb, each
// on a floating card that reveals on scroll.
export default function FeaturesSection() {
  const t = useTranslations("Home.Features");
  const items = [
    { Icon: HeartIcon, title: t("gentle.title"), desc: t("gentle.desc") },
    { Icon: ShieldIcon, title: t("tech.title"), desc: t("tech.desc") },
    { Icon: UsersIcon, title: t("team.title"), desc: t("team.desc") },
    { Icon: CalendarIcon, title: t("booking.title"), desc: t("booking.desc") },
  ] as const;

  return (
    <section className="bg-teal-50/60">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            {t("title")}
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-zinc-600">{t("subtitle")}</p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ Icon, title, desc }, i) => (
            <Reveal key={title} delay={i * 0.07}>
              <FloatCard className="h-full rounded-2xl border border-teal-100 bg-white p-6 shadow-sm">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-600 text-white">
                  <Icon width={24} height={24} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-zinc-900">{title}</h3>
                <p className="mt-2 text-sm text-zinc-600">{desc}</p>
              </FloatCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
