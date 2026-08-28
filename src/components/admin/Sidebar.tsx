import Link from "next/link";
import type { SessionRole } from "@/lib/auth/session";
import LogoutButton from "./LogoutButton";

// Task 12 — dashboard sidebar (FR only). Nav is role-gated: ADMIN-only
// sections (audit for now; team/settings/exports arrive in Tasks 19-21) never
// render for a receptionist. Keyboard-navigable with visible focus rings.

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
  { href: "/admin/audit", label: "Journal d'audit", adminOnly: true },
];

export default function Sidebar({
  name,
  role,
}: {
  name: string;
  role: SessionRole;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-6 border-r border-slate-200 bg-white p-4">
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
    </aside>
  );
}
