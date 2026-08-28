"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Task 12 — logout button (client): POST /api/auth/logout then replace to the
// login page.

export default function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/admin/login");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700
        hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2
        focus-visible:ring-teal-600 focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Déconnexion…" : "Se déconnecter"}
    </button>
  );
}
