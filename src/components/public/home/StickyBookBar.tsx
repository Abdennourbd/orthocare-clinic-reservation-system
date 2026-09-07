"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CLINIC_IDENTITY } from "@/lib/settings/clinicIdentity";
import { PhoneIcon } from "../icons";

// Home-only mobile booking bar: 82% of dental bookings happen on mobile
// and CTAs that disappear on scroll kill conversion. Call (quiet) + Book
// (primary), always visible below sm, safe-area aware. Rendered only on the
// home page — token/booking pages stay clean.
export default function StickyBookBar() {
  const t = useTranslations("Home");
  const telHref = `tel:${CLINIC_IDENTITY.phone.replace(/[\s-]/g, "")}`;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:hidden">
      <div className="mx-auto flex max-w-6xl gap-3">
        <a
          href={telHref}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-zinc-300 bg-white px-4 py-3 text-sm font-semibold text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <PhoneIcon width={16} height={16} aria-hidden />
          {t("heroCall")}
        </a>
        <Link
          href="/book"
          className="inline-flex flex-[2] items-center justify-center rounded-full bg-teal-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          {t("cta")}
        </Link>
      </div>
    </div>
  );
}
