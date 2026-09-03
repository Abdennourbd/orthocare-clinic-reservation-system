import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listActiveServices } from "@/lib/public/services";
import { readBookingPolicy, readConsentVersion } from "@/lib/booking/policy";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import BookingWizard from "@/components/public/BookingWizard/BookingWizard";

// The booking page must always be server-rendered fresh: it bakes clinic-local
// "today", the service list and the current consent version, all of which go
// stale if prerendered at build time.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Booking" });
  return pageMetadata(locale, "/book", t("title"), t("intro"));
}

export default async function BookPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("Booking");

  const [services, policy, consentVersion] = await Promise.all([
    listActiveServices(locale),
    readBookingPolicy(),
    readConsentVersion(),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-900">
        {t("title")}
      </h1>
      <p className="mt-2 text-zinc-600">{t("intro")}</p>

      <div className="mt-8">
        {services.length === 0 ? (
          <p className="text-sm text-zinc-600">{t("noServices")}</p>
        ) : (
          <BookingWizard
            initialData={{
              services,
              consentVersion,
              today: toClinicLocalDateString(new Date()),
              maxHorizonDays: policy.maxHorizonDays,
            }}
          />
        )}
      </div>
    </div>
  );
}