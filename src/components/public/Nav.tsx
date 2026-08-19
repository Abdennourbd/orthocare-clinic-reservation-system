import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const items = [
  { key: "home", href: "/" },
  { key: "services", href: "/services" },
  { key: "testimonials", href: "/testimonials" },
  { key: "faq", href: "/faq" },
  { key: "gallery", href: "/gallery" },
  { key: "about", href: "/about" },
  { key: "contact", href: "/contact" },
] as const;

export default function Nav() {
  const t = useTranslations("Nav");
  return (
    <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="text-sm font-medium text-zinc-700 transition-colors hover:text-teal-700"
        >
          {t(item.key)}
        </Link>
      ))}
    </nav>
  );
}
