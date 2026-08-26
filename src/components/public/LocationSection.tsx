import { getTranslations } from "next-intl/server";
import { CLINIC_LOCATION } from "@/lib/settings/clinicLocation";
import ClinicMap from "./ClinicMap";
import DirectionsButton from "./DirectionsButton";

export default async function LocationSection() {
  const t = await getTranslations("Location");
  return (
    <section
      className="bg-gradient-to-b from-white to-teal-50/60"
      aria-labelledby="location-title"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <h2
          id="location-title"
          className="text-center text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl"
        >
          {t("title")}
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-center text-zinc-600">
          {t("subtitle")}
        </p>

        <div className="mt-10 grid items-stretch gap-8 lg:grid-cols-2">
          <div className="flex flex-col justify-center gap-4">
            <div>
              <p className="text-sm font-semibold text-zinc-900">
                {t("addressLabel")}
              </p>
              <p className="mt-1 text-zinc-600">{CLINIC_LOCATION.address}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">
                {t("phoneLabel")}
              </p>
              <p className="mt-1 text-zinc-600" dir="ltr">
                <a
                  href={`tel:${CLINIC_LOCATION.phone.replace(/\s/g, "")}`}
                  className="hover:text-teal-700"
                >
                  {CLINIC_LOCATION.phone}
                </a>
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-900">
                {t("hoursLabel")}
              </p>
              <p className="mt-1 text-zinc-600">{t("hours")}</p>
            </div>
            <div className="mt-2">
              <DirectionsButton />
            </div>
          </div>

          <div className="min-h-72">
            <ClinicMap />
          </div>
        </div>
      </div>
    </section>
  );
}