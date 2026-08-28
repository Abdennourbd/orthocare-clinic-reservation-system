"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// Task 12 — login form for the FR-only dashboard. On success it routes to the
// dashboard, or straight to the forced password-change screen when the account
// carries `mustChangePassword` (admin-issued reset).

interface LoginResponse {
  user?: { mustChangePassword: boolean };
  error?: { message: string };
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await response.json()) as LoginResponse;
      if (!response.ok) {
        setError(body.error?.message ?? "Connexion impossible.");
        return;
      }
      router.replace(
        body.user?.mustChangePassword ? "/admin/change-password" : "/admin",
      );
    } catch {
      setError("Connexion impossible. Vérifiez votre réseau.");
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
      aria-labelledby="login-title"
    >
      <div className="space-y-1">
        <h1 id="login-title" className="text-xl font-semibold text-slate-900">
          Ortho&rsquo;Care — Administration
        </h1>
        <p className="text-sm text-slate-500">
          Espace réservé au personnel de la clinique.
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
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="password" className="block text-sm font-medium text-slate-700">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
