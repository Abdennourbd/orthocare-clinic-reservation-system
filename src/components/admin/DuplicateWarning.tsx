"use client";

import { useEffect, useRef } from "react";

// Task 13 step 7 — inline (never blocking) duplicate-candidate banner, shared
// by the create form (this step) and, from step 8, the edit form. This is the
// explicit acceptance criterion from tasks/todo.md: "duplicate warning renders
// inline with an explicit save-anyway acknowledgment (never a dead-end
// blocking modal)". No `window.confirm`, no `<dialog>`, no overlay, no
// disabling the save button — the form underneath stays fully editable while
// this is visible (see PatientForm.tsx, which never disables its submit
// button because of this banner's presence, only during the in-flight
// fetch).
//
// The route layer (src/app/api/admin/patients/route.ts and .../[id]/route.ts)
// returns THREE distinct 409 codes, never conflated (task-13.md étape 4 tour
// 2 + étape 5 tour 2 — deliberately separate acknowledgement gates so
// dismissing one warning can never silently dismiss another):
//  - DUPLICATE_CANDIDATES   — a homonym (matched by name). Acknowledged by
//    resubmitting with `duplicateAcknowledged: true`.
//  - PHONE_ALREADY_REGISTERED — the phone number is already used by another
//    record (legitimate in Algeria — families share one phone). Acknowledged
//    with `phoneSharingAcknowledged: true`.
//  - INDISTINGUISHABLE_RECORDS — a single candidate matches BOTH name and
//    phone (PATCH-only today, task-13.md étape 5 tour 2 [BLOQUANT]); needs
//    BOTH acknowledgements at once. Handled here too since this component is
//    the one step 8's edit form will reuse verbatim.
// `duplicates` never carries more than the fields the API itself returns
// (id, firstName, lastName, phone, active) — never notes/email/birthDate.
// `dir="auto"` on every candidate's name and phone: a homonym may be named
// in Arabic script inside this LTR dashboard (task-13.md étape 7 spec).

export type DuplicateWarningCode =
  | "DUPLICATE_CANDIDATES"
  | "PHONE_ALREADY_REGISTERED"
  | "INDISTINGUISHABLE_RECORDS";

export interface DuplicateCandidate {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  active: boolean;
  matchedOn: Array<"NAME" | "PHONE">;
}

export interface DuplicateWarningState {
  code: DuplicateWarningCode;
  message: string;
  duplicates: DuplicateCandidate[];
}

const ACK_LABEL: Record<DuplicateWarningCode, string> = {
  DUPLICATE_CANDIDATES: "C'est une personne différente — enregistrer quand même",
  PHONE_ALREADY_REGISTERED: "C'est un téléphone partagé — enregistrer quand même",
  INDISTINGUISHABLE_RECORDS: "Ce sont bien deux personnes différentes — enregistrer quand même",
};

export default function DuplicateWarning({
  warning,
  onAcknowledge,
  acknowledging,
}: {
  warning: DuplicateWarningState;
  onAcknowledge: () => void;
  acknowledging: boolean;
}) {
  const bannerRef = useRef<HTMLDivElement>(null);

  // Focus moves to the banner as soon as it appears (or its code changes,
  // e.g. a NAME warning resolved into a PHONE one) — the acceptance
  // criterion is explicit that it must be announced (`role="alert"`) and
  // reachable without a mouse.
  useEffect(() => {
    bannerRef.current?.focus();
  }, [warning.code]);

  return (
    <div
      ref={bannerRef}
      role="alert"
      tabIndex={-1}
      className="space-y-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm
        text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
    >
      <p className="font-medium">{warning.message}</p>

      <ul className="space-y-2">
        {warning.duplicates.map((candidate) => (
          <li
            key={candidate.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-white/60 px-3 py-2"
          >
            <span className="font-medium text-amber-950" dir="auto">
              {candidate.lastName} {candidate.firstName}
            </span>
            <span dir="auto">{candidate.phone}</span>
            <span>{candidate.active ? "Actif" : "Inactif"}</span>
            <a
              href={`/admin/patients/${candidate.id}`}
              className="ml-auto rounded-md px-2 py-1 text-teal-800 underline
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600
                focus-visible:ring-offset-2"
            >
              Ouvrir la fiche existante
            </a>
          </li>
        ))}
      </ul>

      <div>
        <button
          type="button"
          onClick={onAcknowledge}
          disabled={acknowledging}
          className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white
            hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-teal-600 focus-visible:ring-offset-2
            disabled:cursor-not-allowed disabled:opacity-60"
        >
          {acknowledging ? "Enregistrement…" : ACK_LABEL[warning.code]}
        </button>
      </div>
    </div>
  );
}
