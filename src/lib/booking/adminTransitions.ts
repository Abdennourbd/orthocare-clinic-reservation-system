import {
  AppointmentStatus,
  AuditAction,
  CancelReason,
} from "@/generated/prisma/client";

// Task 14 — the single source of truth for staff status changes on an
// appointment (PATCH /api/admin/appointments/[id]). Every route (and every
// test) reads the same mapping here instead of re-declaring "which status,
// which timestamp, which audit action, which SMS" per action.
//
// Pure on purpose: no DB, no messaging imports. The SMS senders live in
// src/lib/messaging/appointmentChanges.ts (they touch the DB); referencing
// them by stable NAME keeps this module importable from a unit test without
// dragging in a database connection, while the routes resolve the name to the
// real function.

/** The staff actions accepted by PATCH /api/admin/appointments/[id]. */
export type AdminStatusAction = "CONFIRM" | "CANCEL" | "COMPLETE" | "NO_SHOW";

/** Stable names of the senders in src/lib/messaging/appointmentChanges.ts.
 * COMPLETE/NO_SHOW have no sender — there is no patient-facing template for
 * them in the existing senders (plan Task 14 §Notes: no SMS for these). */
export type SmsSenderName =
  | "sendAppointmentConfirmation"
  | "sendAppointmentCancelled";

export type AdminTransition = {
  /** The status the appointment lands in. */
  newStatus: AppointmentStatus;
  /** The status timestamp that must be set to "now" on the write. */
  timestampField: "confirmedAt" | "cancelledAt" | "completedAt" | "noShowAt";
  /** The audit action logged with the STAFF actor. */
  auditAction: AuditAction;
  /** The CancelReason recorded on the release; null when no slot is freed. */
  cancelReason: CancelReason | null;
  /** Which sender to invoke (failures swallowed — messaging never fails the
   * status change); null when no SMS accompanies the transition. */
  smsSender: SmsSenderName | null;
  /** Whether the slot must be freed through releaseSlot() (so the waitlist
   * slot-freed event fires). Only CANCEL frees a slot; COMPLETE/NO_SHOW keep
   * the slot as-is (it is in the past by the time staff mark it). */
  releasesSlot: boolean;
};

export const STATUS_TRANSITIONS: Record<AdminStatusAction, AdminTransition> = {
  // Confirm-after-call: stamps confirmedAt (+ confirmedByUserId, set by the
  // route) and sends the confirmation SMS carrying the self-service link.
  CONFIRM: {
    newStatus: AppointmentStatus.CONFIRMED,
    timestampField: "confirmedAt",
    auditAction: AuditAction.APPOINTMENT_CONFIRMED,
    cancelReason: null,
    smsSender: "sendAppointmentConfirmation",
    releasesSlot: false,
  },
  // Staff cancel frees the slot through releaseSlot(STAFF) so the waitlist
  // fires, and messages the patient.
  CANCEL: {
    newStatus: AppointmentStatus.CANCELLED,
    timestampField: "cancelledAt",
    auditAction: AuditAction.APPOINTMENT_CANCELLED,
    cancelReason: CancelReason.STAFF,
    smsSender: "sendAppointmentCancelled",
    releasesSlot: true,
  },
  // Complete / no-show: bookkeeping on a past appointment — no slot change,
  // no SMS (no sender exists for these).
  COMPLETE: {
    newStatus: AppointmentStatus.COMPLETED,
    timestampField: "completedAt",
    auditAction: AuditAction.APPOINTMENT_COMPLETED,
    cancelReason: null,
    smsSender: null,
    releasesSlot: false,
  },
  NO_SHOW: {
    newStatus: AppointmentStatus.NO_SHOW,
    timestampField: "noShowAt",
    auditAction: AuditAction.APPOINTMENT_NO_SHOW,
    cancelReason: null,
    smsSender: null,
    releasesSlot: false,
  },
};

/** The transition for a validated action. Zod (`appointmentStatusChangeSchema`)
 * guarantees the action is one of the four keys before this is called. */
export function getAdminTransition(
  action: AdminStatusAction,
): AdminTransition {
  return STATUS_TRANSITIONS[action];
}
