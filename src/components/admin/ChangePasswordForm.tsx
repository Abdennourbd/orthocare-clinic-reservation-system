"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// Task 12 — password change form, used both for the forced change
// (`mustChangePassword` after an admin-issued reset) and voluntary changes.

export default function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setError(body.error?.message ?? "Modification impossible.");
        return;
      }
      router.replace("/admin");
    } catch {
      setError("Modification impossible. Vérifiez votre réseau.");
    } finally {
      setPending(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full max-w-sm space-y-4 rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      aria-labelledby="change-password-title"
    >
      <div className="space-y-1">
        <h1 id="change-password-title" className="text-xl font-semibold text-slate-900">
          Changer le mot de passe
        </h1>
        <p className="text-sm text-slate-500">
          Minimum 12 caractères. Évitez les mots de passe trop courants.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="currentPassword" className="block text-sm font-medium text-slate-700">
          Mot de passe actuel
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="newPassword" className="block text-sm font-medium text-slate-700">
          Nouveau mot de passe
        </label>
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700">
          Confirmer le nouveau mot de passe
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white
          hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-teal-600 focus-visible:ring-offset-2
          disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </form>
  );
}
