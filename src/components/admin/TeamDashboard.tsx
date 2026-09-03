"use client";

import { useEffect, useState, type FormEvent } from "react";

// Task 20 — team dashboard (ADMIN only): list staff, create receptionists,
// deactivate/reactivate, change role, issue a one-time password reset.
// FR-only, like every admin screen. Same visual language as ExportsDashboard
// (teal-700 primary, slate cards, focus rings) so the dashboard stays
// consistent instead of generic.

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "RECEPTIONIST";
  active: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

const inputClass =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";

const buttonPrimaryClass =
  "rounded-md bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const buttonSecondaryClass =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const buttonDangerClass =
  "rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Algiers",
  });
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // Non-JSON error — fall through to the generic message.
  }
  return fallback;
}

export default function TeamDashboard({ currentUserId }: { currentUserId: string }) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/team");
      if (!response.ok) {
        setLoadError("Impossible de charger l'équipe.");
        setMembers(null);
        return;
      }
      const body = (await response.json()) as { members: TeamMember[] };
      setMembers(body.members);
    } catch {
      setLoadError("Impossible de charger l'équipe.");
      setMembers(null);
    } finally {
      setLoading(false);
    }
  };

  // Initial read on mount (same inline-IIFE + cancelled-flag shape as
  // WaitlistDashboard/AuditViewer — the fetch never lives in a callback the
  // effect would call).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch("/api/admin/team");
        if (cancelled || !response.ok) {
          if (!cancelled) {
            setLoadError("Impossible de charger l'équipe.");
            setMembers(null);
          }
          return;
        }
        const body = (await response.json()) as { members: TeamMember[] };
        if (cancelled) return;
        setMembers(body.members);
      } catch {
        if (!cancelled) {
          setLoadError("Impossible de charger l'équipe.");
          setMembers(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    setCreating(true);
    try {
      const response = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      if (!response.ok) {
        setFormError(await readError(response, "Création impossible."));
        return;
      }
      const body = (await response.json()) as { user: TeamMember };
      setName("");
      setEmail("");
      setPassword("");
      setNotice(`Compte créé pour ${body.user.email}. Transmettez-lui le mot de passe temporaire : il devra en choisir un nouveau à sa première connexion.`);
      await load();
    } catch {
      setFormError("Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(member: TeamMember) {
    if (confirmId !== member.id) {
      setConfirmId(member.id);
      setRowError(null);
      return;
    }
    setConfirmId(null);
    setRowBusy(member.id);
    setRowError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !member.active }),
      });
      if (!response.ok) {
        setRowError(await readError(response, "Mise à jour impossible."));
        return;
      }
      setNotice(member.active ? `${member.email} désactivé : sa session est révoquée.` : `${member.email} réactivé.`);
      await load();
    } catch {
      setRowError("Mise à jour impossible.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleRoleChange(member: TeamMember, role: "ADMIN" | "RECEPTIONIST") {
    if (role === member.role) return;
    setRowBusy(member.id);
    setRowError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!response.ok) {
        setRowError(await readError(response, "Changement de rôle impossible."));
        return;
      }
      setNotice(`Rôle de ${member.email} : ${role === "ADMIN" ? "administrateur" : "réceptionniste"}.`);
      await load();
    } catch {
      setRowError("Changement de rôle impossible.");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleReset(event: FormEvent, member: TeamMember) {
    event.preventDefault();
    setRowBusy(member.id);
    setRowError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/team/${member.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: resetPassword }),
      });
      if (!response.ok) {
        setRowError(await readError(response, "Réinitialisation impossible."));
        return;
      }
      setResetId(null);
      setResetPassword("");
      setNotice(`Mot de passe de ${member.email} réinitialisé : transmettez-lui le mot de passe temporaire. Sa session est révoquée, il devra en choisir un nouveau à sa prochaine connexion.`);
      await load();
    } catch {
      setRowError("Réinitialisation impossible.");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Équipe</h1>
        <p className="text-sm text-slate-500">
          Comptes du personnel, désactivation et réinitialisation des mots de passe.
          Chaque action est enregistrée dans le journal d&apos;audit.
        </p>
      </header>

      <div aria-live="polite">
        {notice ? (
          <p role="status" className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
            {notice}
          </p>
        ) : null}
        {rowError ? (
          <p role="alert" className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {rowError}
          </p>
        ) : null}
      </div>

      <section
        aria-labelledby="team-create-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="team-create-heading" className="text-base font-semibold text-slate-900">
          Créer un compte réceptionniste
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Le nouveau membre devra choisir un nouveau mot de passe à sa première connexion.
        </p>
        <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="team-name" className="block text-sm font-medium text-slate-700">
              Nom
            </label>
            <input
              id="team-name"
              type="text"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
              required
              maxLength={100}
            />
          </div>
          <div>
            <label htmlFor="team-email" className="block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="team-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
              required
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="team-password" className="block text-sm font-medium text-slate-700">
              Mot de passe temporaire
            </label>
            <input
              id="team-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
              required
              minLength={12}
              aria-describedby="team-password-hint"
            />
            <p id="team-password-hint" className="mt-1 text-xs text-slate-500">
              12 caractères minimum.
            </p>
          </div>
          <div className="flex items-end sm:col-span-3">
            <button type="submit" disabled={creating} className={buttonPrimaryClass}>
              {creating ? "Création…" : "Créer le compte"}
            </button>
          </div>
        </form>
        {formError ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {formError}
          </p>
        ) : null}
      </section>

      <section
        aria-labelledby="team-list-heading"
        className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="team-list-heading" className="text-base font-semibold text-slate-900">
          Membres de l&apos;équipe
        </h2>
        <div aria-live="polite" className="mt-4">
          {loading ? (
            <div aria-busy="true" aria-label="Chargement de l'équipe" className="space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : loadError ? (
            <div className="flex items-center gap-3">
              <p role="alert" className="text-sm text-red-700">
                {loadError}
              </p>
              <button type="button" onClick={() => void load()} className={buttonSecondaryClass}>
                Réessayer
              </button>
            </div>
          ) : members === null || members.length === 0 ? (
            <p role="status" className="text-sm text-slate-500">
              Aucun membre pour le moment. Créez le premier compte réceptionniste ci-dessus.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th scope="col" className="px-2 py-2">Nom</th>
                    <th scope="col" className="px-2 py-2">Email</th>
                    <th scope="col" className="px-2 py-2">Rôle</th>
                    <th scope="col" className="px-2 py-2">Statut</th>
                    <th scope="col" className="px-2 py-2">Dernière connexion</th>
                    <th scope="col" className="px-2 py-2">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => {
                    const isSelf = member.id === currentUserId;
                    const busy = rowBusy === member.id;
                    return (
                      <tr key={member.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-2 py-2 font-medium text-slate-900">
                          {member.name}
                          {isSelf ? <span className="ml-2 text-xs font-normal text-slate-500">(vous)</span> : null}
                        </td>
                        <td className="px-2 py-2 text-slate-700">{member.email}</td>
                        <td className="px-2 py-2">
                          <label className="sr-only" htmlFor={`team-role-${member.id}`}>
                            Rôle de {member.email}
                          </label>
                          <select
                            id={`team-role-${member.id}`}
                            value={member.role}
                            disabled={busy || isSelf}
                            onChange={(e) => void handleRoleChange(member, e.target.value as "ADMIN" | "RECEPTIONIST")}
                            className={`${inputClass} py-1.5`}
                          >
                            <option value="RECEPTIONIST">Réceptionniste</option>
                            <option value="ADMIN">Administrateur</option>
                          </select>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          {member.active ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800">
                              Actif
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              Désactivé
                            </span>
                          )}
                          {member.mustChangePassword ? (
                            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Nouveau mot de passe requis
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                          {formatDateTime(member.lastLoginAt)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={busy || isSelf}
                              onClick={() => void handleToggleActive(member)}
                              className={member.active ? buttonDangerClass : buttonSecondaryClass}
                              aria-label={member.active ? `Désactiver ${member.email}` : `Réactiver ${member.email}`}
                            >
                              {confirmId === member.id
                                ? "Confirmer ?"
                                : member.active
                                  ? "Désactiver"
                                  : "Réactiver"}
                            </button>
                            {confirmId === member.id ? (
                              <button
                                type="button"
                                onClick={() => setConfirmId(null)}
                                className={buttonSecondaryClass}
                              >
                                Annuler
                              </button>
                            ) : null}
                            {resetId === member.id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setResetId(null);
                                  setResetPassword("");
                                }}
                                className={buttonSecondaryClass}
                              >
                                Fermer
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy || isSelf}
                                onClick={() => {
                                  setResetId(member.id);
                                  setResetPassword("");
                                  setRowError(null);
                                }}
                                className={buttonSecondaryClass}
                                aria-label={`Réinitialiser le mot de passe de ${member.email}`}
                                aria-expanded={resetId === member.id}
                              >
                                Réinitialiser
                              </button>
                            )}
                          </div>
                          {resetId === member.id ? (
                            <form onSubmit={(e) => void handleReset(e, member)} className="mt-2 flex flex-wrap items-end gap-2">
                              <div>
                                <label htmlFor={`team-reset-${member.id}`} className="block text-xs font-medium text-slate-700">
                                  Nouveau mot de passe temporaire
                                </label>
                                <input
                                  id={`team-reset-${member.id}`}
                                  type="password"
                                  autoComplete="new-password"
                                  value={resetPassword}
                                  onChange={(e) => setResetPassword(e.target.value)}
                                  className={`${inputClass} mt-1`}
                                  required
                                  minLength={12}
                                />
                              </div>
                              <button type="submit" disabled={busy || resetPassword.length < 12} className={buttonPrimaryClass}>
                                {busy ? "…" : "Valider"}
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
