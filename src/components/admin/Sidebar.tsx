import Link from "next/link";
import type { SessionRole } from "@/lib/auth/session";
import LogoutButton from "./LogoutButton";

// Task 12 — dashboard sidebar (FR only). Nav is role-gated: ADMIN-only
// sections never render for a receptionist. Keyboard-navigable with visible
// focus rings. Task 21 adds Contenu / Fermetures / Réglages (ADMIN-only).
//
// Mobile (staff use phones): the desktop <aside> is hidden below `md` and
// the same links render in the MobileNav drawer instead. SidebarBody is the
// single source of both so the two can never drift (same items, same
// role-gating, same labels).

const ROLE_LABEL: Record<SessionRole, string> = {
  ADMIN: "Administrateur",
  RECEPTIONIST: "Réceptionniste",
};

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  adminOnly: boolean;
}> = [
  { href: "/admin", label: "Tableau de bord", adminOnly: false },
  { href: "/admin/patients", label: "Patients", adminOnly: false },
  { href: "/admin/appointments", label: "Rendez-vous", adminOnly: false },
  { href: "/admin/waitlist", label: "Liste d'attente", adminOnly: false },
  { href: "/admin/sms", label: "SMS", adminOnly: false },
  { href: "/admin/exports", label: "Exports", adminOnly: true },
  { href: "/admin/content", label: "Contenu", adminOnly: true },
  { href: "/admin/closures", label: "Fermetures", adminOnly: true },
  { href: "/admin/settings", label: "Réglages", adminOnly: true },
  { href: "/admin/team", label: "Équipe", adminOnly: true },
  { href: "/admin/audit", label: "Journal d'audit", adminOnly: true },
];

export function SidebarBody({
  name,
  role,
  onNavigate,
}: {
  name: string;
  role: SessionRole;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div>
        <p className="text-lg font-semibold text-slate-900">Ortho&rsquo;Care</p>
        <p className="text-xs text-slate-500">Administration</p>
      </div>

      <nav aria-label="Navigation principale" className="flex flex-col gap-1">
        {NAV_ITEMS.filter((item) => !item.adminOnly || role === "ADMIN").map(
          (item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700
                hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-teal-600 focus-visible:ring-offset-2"
            >
              {item.label}
            </Link>
          ),
        )}
      </nav>

      <div className="mt-auto space-y-2 border-t border-slate-200 pt-4">
        <div className="px-1">
          <p className="truncate text-sm font-medium text-slate-900">{name}</p>
          <p className="text-xs text-slate-500">{ROLE_LABEL[role]}</p>
        </div>
        <LogoutButton />
      </div>
    </>
  );
}

export default function Sidebar({
  name,
  role,
}: {
  name: string;
  role: SessionRole;
}) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-slate-200 bg-white p-4 md:flex">
      <SidebarBody name={name} role={role} />
    </aside>
  );
}
