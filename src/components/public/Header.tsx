import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import Nav from "./Nav";
import LocaleSwitcher from "./LocaleSwitcher";

export default function Header() {
  const t = useTranslations();
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
            O
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-900">
            {t("Header.clinicName")}
          </span>
        </Link>

        <Nav />

        <div className="flex items-center gap-3">
          <LocaleSwitcher />
          <Link
            href="/book"
            className="hidden rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 sm:inline-block"
          >
            {t("Nav.book")}
          </Link>
        </div>
      </div>
    </header>
  );
}
