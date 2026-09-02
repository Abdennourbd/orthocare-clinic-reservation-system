"use client";

import { useCallback, useState } from "react";
import type { SessionRole } from "@/lib/auth/session";
import ManualSmsForm from "./ManualSmsForm";
import BroadcastForm from "./BroadcastForm";
import SmsHistory from "./SmsHistory";

// Task 16 — SMS Center shell. Same tabs-lite pattern as
// AppointmentsDashboard: a nav with aria-current, all sections stay mounted
// and are toggled with `hidden` so pending state survives tab switches.
// The Diffusion section is only MOUNTED for ADMIN (the server page passes
// the role; the API routes enforce the same rule independently).
//
// Child outcomes funnel into the top banner through `onNotify`, and a
// broadcast send bumps `reloadToken` so the (hidden) SmsHistory refetches
// both lists — same bumpReload pattern as AppointmentsDashboard.

export interface SmsBanner {
  kind: "success" | "error" | "info";
  message: string;
}

type TabKey = "envoi" | "diffusion" | "historique";

const TABS: Array<{ key: TabKey; label: string; adminOnly: boolean }> = [
  { key: "envoi", label: "Envoi manuel", adminOnly: false },
  { key: "diffusion", label: "Diffusion", adminOnly: true },
  { key: "historique", label: "Historique", adminOnly: false },
];

const BANNER_CLASSES: Record<SmsBanner["kind"], string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-700",
  info: "border-teal-200 bg-teal-50 text-teal-800",
};

export default function SmsCenter({ role }: { role: SessionRole }) {
  const [tab, setTab] = useState<TabKey>("envoi");
  const [banner, setBanner] = useState<SmsBanner | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const bumpReload = useCallback(() => setReloadToken((t) => t + 1), []);
  const handleNotify = useCallback((next: SmsBanner) => setBanner(next), []);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">SMS</h1>
        <p className="text-sm text-slate-500">
          Envoi manuel aux patients, diffusion des retards et historique des messages.
        </p>
      </header>

      {banner && (
        <p
          role={banner.kind === "error" ? "alert" : "status"}
          className={`rounded-md border px-3 py-2 text-sm ${BANNER_CLASSES[banner.kind]}`}
        >
          {banner.message}
        </p>
      )}

      <nav aria-label="Sections SMS" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.filter((t) => !t.adminOnly || role === "ADMIN").map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={
              "rounded-t-md px-4 py-2 text-sm font-medium focus-visible:outline-none " +
              "focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
              (tab === t.key
                ? "border-x border-t border-slate-200 bg-white text-teal-800"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-800")
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div hidden={tab !== "envoi"}>
        <ManualSmsForm onNotify={handleNotify} />
      </div>
      {role === "ADMIN" && (
        <div hidden={tab !== "diffusion"}>
          <BroadcastForm onNotify={handleNotify} onSent={bumpReload} />
        </div>
      )}
      <div hidden={tab !== "historique"}>
        <SmsHistory reloadToken={reloadToken} />
      </div>
    </div>
  );
}
