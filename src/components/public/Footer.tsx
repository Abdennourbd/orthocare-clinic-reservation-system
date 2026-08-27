import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CLINIC_LOCATION } from "@/lib/settings/clinicLocation";
import DirectionsButton from "./DirectionsButton";

export default function Footer() {
  const t = useTranslations();
  const nav = useTranslations("Nav");
  const footer = useTranslations("Footer");

  const links = [
    { key: "services", href: "/services" },
    { key: "gallery", href: "/gallery" },
    { key: "testimonials", href: "/testimonials" },
    { key: "faq", href: "/faq" },
    { key: "about", href: "/about" },
    { key: "contact", href: "/contact" },
    { key: "privacy", href: "/privacy" },
  ] as const;

  return (
    <footer className="border-t border-zinc-200 bg-zinc-50">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div>
          <p className="text-lg font-semibold text-zinc-900">
            {t("Header.clinicName")}
          </p>
          <p className="mt-2 text-sm text-zinc-600">{footer("tagline")}</p>
        </div>

        <nav aria-label={footer("quickLinks")}>
          <p className="text-sm font-semibold text-zinc-900">
            {footer("quickLinks")}
          </p>
          <ul className="mt-2 space-y-1">
            {links.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  className="text-sm text-zinc-600 hover:text-teal-700"
                >
                  {nav(link.key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <p className="text-sm font-semibold text-zinc-900">
            {footer("contact")}
          </p>
          <p className="mt-2 text-sm text-zinc-600">{CLINIC_LOCATION.address}</p>
          <p className="mt-1 text-sm text-zinc-600" dir="ltr">
            {CLINIC_LOCATION.phone}
          </p>
          <p className="mt-1 text-sm text-zinc-600">{footer("hours")}</p>
          <DirectionsButton className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-teal-700" />
        </div>
      </div>

      <div className="border-t border-zinc-200 py-4 text-center text-xs text-zinc-500">
        © {new Date().getFullYear()} {t("Header.clinicName")}. {footer("rights")}
      </div>
    </footer>
  );
}