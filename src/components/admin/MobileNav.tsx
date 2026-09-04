"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionRole } from "@/lib/auth/session";
import { SidebarBody } from "./Sidebar";

// Mobile navigation drawer for the admin dashboard (staff use phones).
// Below `md` the desktop <aside> is hidden and this hamburger + drawer takes
// over, rendering the SAME SidebarBody (same items, same role-gating) so the
// two can never drift. Closes on link tap, backdrop tap, and Escape; focus
// moves to the close button on open and back to the menu button on close.

export default function MobileNav({
  name,
  role,
}: {
  name: string;
  role: SessionRole;
}) {
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    // Copied inside the effect: the ref object itself is stable, but
    // `.current` may point elsewhere by cleanup time.
    const menuButton = menuButtonRef.current;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      // Focus trap: the drawer is a modal — Tab must cycle inside it,
      // never escape behind the scrim.
      if (e.key !== "Tab") return;
      const dialog = document.getElementById("admin-mobile-nav");
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      menuButton?.focus();
    };
  }, [open ]);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white p-3 md:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={open}
          aria-controls="admin-mobile-nav"
          aria-label="Ouvrir le menu de navigation"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-slate-700 hover:bg-slate-100
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="7" x2="20" y2="7" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="17" x2="20" y2="17" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-slate-900">Ortho&rsquo;Care</p>
      </header>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setOpen(false)}
          />
          <div
            id="admin-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-mobile-nav-title"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <p id="admin-mobile-nav-title" className="text-sm font-semibold text-slate-900">Menu</p>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Fermer le menu de navigation"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 text-slate-700 hover:bg-slate-100
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <SidebarBody name={name} role={role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
