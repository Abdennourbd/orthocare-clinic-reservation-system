"use client";

import { useEffect, useRef, useState } from "react";
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

const linkRing =
  "rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

export default function Nav() {
  const t = useTranslations("Nav");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape closes the menu and returns focus to the menu button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open ]);

  return (
    <>
      <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`text-sm font-medium text-zinc-700 hover:text-teal-700 ${linkRing}`}
          >
            {t(item.key)}
          </Link>
        ))}
      </nav>

      <div className="md:hidden">
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? t("close") : t("menu")}
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100 ${linkRing}`}
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>

        {open && (
          <nav
            id="mobile-nav"
            aria-label="Primary"
            className="absolute inset-x-0 top-16 z-20 border-b border-zinc-200 bg-white shadow-lg"
          >
            <ul className="mx-auto max-w-6xl space-y-1 px-4 py-4 sm:px-6">
              {items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`block rounded-xl px-4 py-3 text-base font-medium text-zinc-800 hover:bg-teal-50 hover:text-teal-700 ${linkRing}`}
                  >
                    {t(item.key)}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/book"
                  onClick={() => setOpen(false)}
                  className={`mt-2 block rounded-xl bg-teal-600 px-4 py-3 text-center text-base font-semibold text-white hover:bg-teal-700 ${linkRing}`}
                >
                  {t("book")}
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </div>
    </>
  );
}
