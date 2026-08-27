import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CLINIC_LOCATION } from "@/lib/settings/clinicLocation";
import Reveal from "@/components/public/motion/Reveal";
import LocationSection from "@/components/public/LocationSection";
import { PhoneIcon } from "@/components/public/icons";

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Contact");
  return { title: t("title"), description: t("subtitle") };
}

export default async function ContactPage() {
  const t = await getTranslations("Contact");

  return (
    <div>
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
        <Reveal className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("title")}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-600">{t("subtitle")}</p>
          <a
            href={`tel:${CLINIC_LOCATION.phone.replace(/\s/g, "")}`}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-teal-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-teal-600/25 transition-all hover:-translate-y-0.5 hover:bg-teal-700"
          >
            <PhoneIcon width={20} height={20} />
            <span dir="ltr">{CLINIC_LOCATION.phone}</span>
          </a>
        </Reveal>
      </div>
      <LocationSection />
    </div>
  );
}
