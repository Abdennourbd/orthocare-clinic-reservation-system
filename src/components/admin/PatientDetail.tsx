"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SessionRole } from "@/lib/auth/session";
import { formatClinicLocalTime, toClinicLocalDateString } from "@/lib/time/clinicTime";
import PatientForm, { type FormValues, type PatientFormSuccess } from "./PatientForm";
import PatientTimeline from "./PatientTimeline";
import AddVisitForm from "./AddVisitForm";
import AnonymizePatientAction from "./AnonymizePatientAction";
import PatientDocuments from "./PatientDocuments";

// Task 13 step 8 — the patient record screen: identity + edit form, unified
// history timeline, manual visit entry, and the two ADMIN-only destructive
// actions (deactivate, anonymize). Reads GET /api/admin/patients/[id]
// (task-13.md étape 5) — that route audits `PATIENT_RECORD_VIEWED` with
// `scope: "record"` on every load, and PatientTimeline's own fetch of
// GET .../history audits a second line with `scope: "history"` — this
// screen therefore produces exactly the two audit rows the acceptance
// criterion requires just by rendering.
//
// `role` is passed down from the server page (which reads it from
// `getStaffFromCookies()`) purely to decide what to RENDER. It is never a
// security boundary: every ADMIN-only action below is also independently
// enforced by its route (`requireStaff(request, { roles: ["ADMIN"] })`), so
// a RECEPTIONIST calling the same endpoint directly (curl, DevTools) gets a
// 403 regardless of what this component chose to show
// (task-13.md §Points de vigilance non négociables — "masquer un bouton
// n'est pas un contrôle d'accès").

interface PatientRecord {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
  active: boolean;
  anonymizedAt: string | null;
  consentAt: string | null;
  consentVersion: string | null;
  messagingOptOut: boolean;
  whatsappOptIn: boolean;
  preferredLocale: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: { name: string } | null;
  updatedBy: { name: string } | null;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const [year, month, day] = toClinicLocalDateString(date).split("-");
  return `${day}/${month}/${year} à ${formatClinicLocalTime(date)}`;
}

function toFormValues(patient: PatientRecord): FormValues {
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    phone: patient.phone,
    email: patient.email ?? "",
    birthDate: patient.birthDate ? patient.birthDate.slice(0, 10) : "",
    notes: patient.notes ?? "",
    messagingOptOut: patient.messagingOptOut,
    whatsappOptIn: patient.whatsappOptIn,
    preferredLocale: (patient.preferredLocale as FormValues["preferredLocale"]) || "",
  };
}

export default function PatientDetail({
  patientId,
  role,
}: {
  patientId: string;
  role: SessionRole;
}) {
  const [patient, setPatient] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [timelineReloadToken, setTimelineReloadToken] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successRef = useRef<HTMLParagraphElement>(null);

  const [deactivateConfirm, setDeactivateConfirm] = useState(false);
  const [deactivatePending, setDeactivatePending] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  // Tracks the last `patientId` the deactivation gate's state was reset for
  // — see the render-time reset just below `handleUpdated`.
  const [deactivateStateForPatientId, setDeactivateStateForPatientId] = useState(patientId);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      setRateLimited(false);
      try {
        const response = await fetch(`/api/admin/patients/${patientId}`);
        if (cancelled) return;
        if (response.status === 429) {
          setRateLimited(true);
          return;
        }
        if (!response.ok) {
          setError(true);
          return;
        }
        const body = (await response.json()) as PatientRecord;
        setPatient(body);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId, reloadToken]);

  useEffect(() => {
    if (successMessage) successRef.current?.focus();
  }, [successMessage]);

  // Correction étape 8 (audit ortho-reviewer, point 1) — this screen now
  // navigates client-side between two patients (next/link, point 2 of the
  // same audit), so PatientDetail is no longer remounted when `patientId`
  // changes. The deactivation gate's own state lives directly in this
  // component (not behind a keyed child boundary the way
  // AnonymizePatientAction's `confirmText` is, below), so it needs an
  // explicit reset — otherwise an "armed" confirm/cancel toggle from patient
  // A would still be showing when the admin lands on patient B. This is the
  // "adjust state during render" pattern React recommends over a
  // `useEffect` for resetting state on a prop change (react-hooks/
  // set-state-in-effect flags a plain setState-in-effect as a cascading
  // extra render) — comparing against a state value holding the last seen
  // `patientId` and calling setState conditionally, inline in the render
  // body, applies
  // synchronously before paint instead of after an extra effect pass.
  if (deactivateStateForPatientId !== patientId) {
    setDeactivateStateForPatientId(patientId);
    setDeactivateConfirm(false);
    setDeactivateError(null);
  }

  // Correction étape 8 (audit ortho-reviewer, point 3) — PATCH's own response
  // body is already the full record (same `patientRecordSelect` shape as
  // GET), so it is used directly to update state instead of firing a second
  // GET via `reload()`. That second GET used to double the
  // `PATIENT_RECORD_VIEWED scope:"record"` audit line on every save and
  // spend a second token from the shared 60/5min `patients-read` budget for
  // no new information. `PatientForm`'s `onSuccess` prop is typed
  // `PatientFormSuccess` because it is shared with PatientList's CREATE flow
  // (POST returns the narrower `patientListSelect` shape); in EDIT mode
  // (this call site, `patientId` set) the route is
  // PATCH /api/admin/patients/[id], which always responds with the full
  // `patientRecordSelect` shape — i.e. every field of `PatientRecord` — so
  // the cast below is safe here specifically, not in general. This is also
  // what keeps this component's own `key={...updatedAt}` remount (below)
  // working: `updated.updatedAt` is the fresh, DB-written timestamp.
  function handleUpdated(updated: PatientFormSuccess) {
    setSuccessMessage("Modifications enregistrées.");
    setPatient(updated as unknown as PatientRecord);
  }

  function handleVisitCreated() {
    setSuccessMessage("Visite ajoutée.");
    setTimelineReloadToken((t) => t + 1);
  }

  async function handleDeactivateConfirm() {
    setDeactivatePending(true);
    setDeactivateError(null);
    try {
      const response = await fetch(`/api/admin/patients/${patientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setDeactivateError(
          (body?.error?.message as string | undefined) ?? "Impossible de désactiver ce dossier.",
        );
        return;
      }
      setDeactivateConfirm(false);
      setSuccessMessage("Dossier désactivé.");
      reload();
    } catch {
      setDeactivateError("Impossible de joindre le serveur. Vérifiez la connexion et réessayez.");
    } finally {
      setDeactivatePending(false);
    }
  }

  function handleAnonymized() {
    setSuccessMessage("Dossier anonymisé.");
    reload();
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <p className="text-sm text-slate-500" role="status">
          Chargement…
        </p>
      </div>
    );
  }

  // Correction étape 8 (audit ortho-security, point 4) — a 429 is not a
  // server failure, and opening a chart already spends 2 tokens of the
  // shared `staff:<userId>:patients-read` budget (60/5min): this record view
  // plus PatientTimeline's own history fetch. A generic "Réessayer" button
  // here would let staff burn a THIRD token immediately, worsening the exact
  // situation the rate limiter exists to contain. No retry button — the
  // budget refills on its own after the window passes.
  if (rateLimited) {
    return (
      <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
        <p role="alert" className="text-sm text-amber-800">
          Trop de consultations de dossiers en peu de temps. Réessayez dans quelques minutes.
        </p>
      </div>
    );
  }

  if (error || !patient) {
    return (
      <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
        <p role="alert" className="text-sm text-red-700">
          Impossible de charger ce dossier patient.
        </p>
        <button
          type="button"
          onClick={reload}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700
            hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          Réessayer
        </button>
      </div>
    );
  }

  const isAnonymized = patient.anonymizedAt !== null;

  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-1">
        <Link
          href="/admin/patients"
          className="text-sm text-teal-700 underline focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          ← Retour à la liste des patients
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900" dir="auto">
          {patient.lastName} {patient.firstName}
        </h1>
        <p className="text-sm text-slate-500">
          {isAnonymized ? "Anonymisé" : patient.active ? "Actif" : "Inactif"} — dossier créé le{" "}
          {formatDateTime(patient.createdAt)}
          {patient.createdBy ? ` par ${patient.createdBy.name}` : ""}, modifié le{" "}
          {formatDateTime(patient.updatedAt)}
          {patient.updatedBy ? ` par ${patient.updatedBy.name}` : ""}.
        </p>
      </header>

      {successMessage && (
        <p
          ref={successRef}
          role="status"
          tabIndex={-1}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm
            text-emerald-800 focus:outline-none"
        >
          {successMessage}
        </p>
      )}

      {isAnonymized && (
        <p role="status" className="rounded-md border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-700">
          Dossier anonymisé — identifiants effacés. L&rsquo;historique des rendez-vous et des
          visites est conservé volontairement (sans notes), pour que les statistiques de la
          clinique restent exactes.
        </p>
      )}

      <PatientForm
        key={`${patient.id}-${patient.updatedAt}`}
        patientId={patient.id}
        initialValues={toFormValues(patient)}
        readOnly={isAnonymized}
        submitLabel="Enregistrer les modifications"
        onSuccess={handleUpdated}
      />

      {role === "ADMIN" && !isAnonymized && (
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <h3 className="text-sm font-semibold text-amber-900">Désactivation du dossier</h3>
            {!patient.active ? (
              <p className="text-sm text-amber-900">Ce dossier est déjà désactivé.</p>
            ) : deactivateConfirm ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-amber-900">
                  Le dossier est masqué mais rien n&rsquo;est supprimé ; l&rsquo;historique est
                  conservé.
                </p>
                {deactivateError && <p className="text-sm text-red-700">{deactivateError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDeactivateConfirm}
                    disabled={deactivatePending}
                    className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white
                      hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-teal-600 focus-visible:ring-offset-2
                      disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deactivatePending ? "Désactivation…" : "Confirmer la désactivation"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeactivateConfirm(false)}
                    disabled={deactivatePending}
                    className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-900
                      hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-teal-600 focus-visible:ring-offset-2
                      disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setDeactivateConfirm(true)}
                className="rounded-md border border-amber-400 bg-white px-3 py-2 text-sm font-medium
                  text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2
                  focus-visible:ring-teal-600 focus-visible:ring-offset-2"
              >
                Désactiver ce dossier
              </button>
            )}
          </div>

          {/* Correction étape 8 (audit ortho-reviewer, point 1) — `key`
              forces a fresh mount (and therefore a fresh, empty
              `confirmText`) whenever the record being viewed OR its last
              name changes. Without this, `confirmText` is a plain useState
              that nothing else clears: navigating client-side (next/link,
              point 2 of the same audit) from patient A to a HOMONYM patient
              B would leave the erasure confirm button already armed for B,
              which is exactly the case the duplicate-detection work in this
              task exists to catch. Same remount-via-key convention already
              used on `PatientForm` above. */}
          <AnonymizePatientAction
            key={`${patient.id}-${patient.lastName}`}
            patientId={patient.id}
            lastName={patient.lastName}
            onAnonymized={handleAnonymized}
          />
        </div>
      )}

      <PatientTimeline patientId={patient.id} reloadToken={timelineReloadToken} />

      {!isAnonymized && <AddVisitForm patientId={patient.id} onCreated={handleVisitCreated} />}

      {/* Task 15 step 5 — same visibility rule as AddVisitForm above: hidden
          for an anonymized chart (both documents routes answer 404/409
          there anyway). `role` only decides whether the ADMIN-only delete
          button renders — the DELETE route re-checks the role itself. */}
      {!isAnonymized && <PatientDocuments patientId={patient.id} role={role} />}
    </div>
  );
}
