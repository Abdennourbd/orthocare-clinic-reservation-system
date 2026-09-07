import { useTranslations } from "next-intl";
import { CLINIC_IDENTITY } from "@/lib/settings/clinicIdentity";
import { CalendarIcon, ClockIcon, StarIcon } from "../icons";

// Proof bar (home-ui Task 2): three verifiable facts in normal flow — live
// Google rating, real opening hours, booking promise with the clinic phone.
// Replaces the old overlapping stat cards with invented figures
// (5000+ / 98% appeared nowhere on clinicorthocare.com). Static on purpose:
// no FloatCard, no stagger, no overlap.
export default function TrustStrip() {
  const t = useTranslations("Home");
  const footer = useTranslations("Footer");
  const location = useTranslations("Location");

  const items = [
    {
      Icon: StarIcon,
      iconClass: "bg-amber-50 text-amber-500",
      value: t("heroRating"),
      label: t("proofGoogle"),
    },
    {
      Icon: ClockIcon,
      iconClass: "bg-teal-50 text-teal-600",
      value: footer("hours"),
      label: location("hoursLabel"),
    },
    {
      Icon: CalendarIcon,
      iconClass: "bg-teal-50 text-teal-600",
      value: t("proofBooking"),
      label: CLINIC_IDENTITY.phone,
    },
  ] as const;

  return (
    <section aria-label={t("proofAria")} className="border-y border-zinc-200 bg-zinc-50">
      <ul className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:grid-cols-3 sm:px-6">
        {items.map(({ Icon, iconClass, value, label }) => (
          <li key={label} className="flex items-center gap-3">
            <span
              aria-hidden
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClass}`}
            >
              <Icon width={22} height={22} />
            </span>
            <span>
              <span className="block text-sm font-semibold text-zinc-900">{value}</span>
              <span className="block text-xs text-zinc-500" dir="auto">
                {label}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
