import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Reveal from "@/components/public/motion/Reveal";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Privacy");
  return { title: t("title"), description: t("intro") };
}

export default async function PrivacyPage() {
  const t = await getTranslations("Privacy");

  const sections = [
    { title: t("what.title"), body: t("what.body") },
    { title: t("why.title"), body: t("why.body") },
    { title: t("processors.title"), body: t("processors.body") },
    { title: t("retention.title"), body: t("retention.body") },
    { title: t("rights.title"), body: t("rights.body") },
    { title: t("contact.title"), body: t("contact.body") },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <Reveal>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mt-3 text-sm text-zinc-500">{t("lastUpdated")}</p>
        <p className="mt-6 text-lg text-zinc-600">{t("intro")}</p>
      </Reveal>

      <div className="mt-10 space-y-10">
        {sections.map((s, i) => (
          <Reveal key={s.title} delay={i * 0.03}>
            <section>
              <h2 className="text-xl font-bold tracking-tight text-zinc-900">{s.title}</h2>
              <p className="mt-3 whitespace-pre-line text-zinc-600">{s.body}</p>
            </section>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
