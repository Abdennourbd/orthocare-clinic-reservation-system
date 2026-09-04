import { getPrisma } from "@/lib/db";
import { SmsMessageType } from "@/generated/prisma/client";
import { onSlotFreed, type SlotFreedEvent } from "@/lib/booking/events";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import { sendMessage } from "@/lib/messaging";
import { reportError } from "@/lib/monitoring/reportError";
import { localParts } from "@/lib/messaging/format";
import type { MessageProvider } from "@/lib/messaging/provider";

// Task 17.1 — waitlist slot-freed subscriber.
//
// When any `releaseSlot()` path frees a slot (staff cancel, self-service
// cancel, auto-expiry, reschedule), it emits a `slot-freed` event carrying the
// freed appointment's `serviceId` and window. This subscriber notifies every
// ACTIVE entry for that service whose `preferredDates` contain the freed
// slot's clinic-local date.
//
// Matching rule: `preferredDates` are stored as clinic-local dates at UTC
// midnight (Africa/Algiers has no DST, so the mapping is stable). Both sides
// are compared via `toClinicLocalDateString()` — the ONLY place for date
// maths — so a slot at 23:30Z (00:30 local next day) matches the local date,
// never the UTC day.
//
// Send policy:
// - One SMS per entry via the shared dispatcher (`sendMessage`, type WAITLIST,
//   template `waitlist`). No `appointmentId` is passed — same reason as the
//   Task 16 delay broadcast: the unique `(appointmentId, type)` index would
//   otherwise block notifying a second freed slot for the same appointment.
// - On any non-null result the entry is consumed: `active = false` plus
//   `notifiedAt` (one notification per entry in v1 — the patient can re-watch
//   if they miss it). A provider failure still returns a row (status FAILED),
//   so it also consumes the entry rather than retrying forever.
// - When the dispatcher suppresses the send (returns null: opted-out or
//   inactive patient), the entry STAYS active with `notifiedAt` unset, so the
//   patient keeps their place for the next opportunity. An anonymized patient
//   is skipped explicitly (the dispatcher does not know about `anonymizedAt`).
// - Sends are sequential, not `Promise.all` — gentle on the provider.
// - Never throws: per-entry errors are logged and skipped, and the top level
//   catches everything and returns the count so far. A waitlist failure must
//   never turn a cancellation into a 500.

/**
 * Notify waitlist entries watching the freed slot's clinic-local date.
 *
 * @param provider overrides the env-selected provider (used by tests).
 * @returns the number of entries notified (consumed).
 */
export async function handleSlotFreed(
  event: SlotFreedEvent,
  provider?: MessageProvider,
): Promise<number> {
  try {
    const freedLocalDate = toClinicLocalDateString(event.startTime);
    const entries = await getPrisma().waitlistEntry.findMany({
      where: { serviceId: event.serviceId, active: true },
      include: { patient: true, service: true },
    });

    let notified = 0;
    for (const entry of entries) {
      try {
        const watches = entry.preferredDates.some(
          (d) => toClinicLocalDateString(d) === freedLocalDate,
        );
        if (!watches) continue;

        const patient = entry.patient;
        if (!patient || patient.active === false) continue;
        // The dispatcher suppresses opt-out/inactive itself (returns null),
        // but anonymization is invisible to it — skip explicitly and keep the
        // entry active (it will be deactivated by the erasure path anyway).
        if (patient.anonymizedAt !== null) continue;

        // Claim FIRST, send second: two concurrent frees on the same watched
        // date must not double-notify one entry (v1 = one notification per
        // entry). The WHERE only matches a still-active entry, so exactly one
        // winner claims it; the loser sees count 0 and moves on BEFORE any
        // SMS is sent. Claiming after the send would be too late — both
        // racers would already have messaged.
        const { count: claimed } = await getPrisma().waitlistEntry.updateMany({
          where: { id: entry.id, active: true },
          data: { active: false },
        });
        if (claimed === 0) continue;

        const message = await sendMessage(
          {
            type: SmsMessageType.WAITLIST,
            patientId: patient.id,
            to: patient.phoneE164,
            templateKey: "waitlist",
            vars: {
              firstName: patient.firstName,
              serviceName: localized(
                entry.service.name as LocalizedField,
                "fr",
              ),
              ...localParts(event.startTime),
            },
          },
          provider,
        );
        // Suppressed (opt-out/inactive race): release the claim so the entry
        // stays active for the next opportunity, notifiedAt untouched.
        if (message === null) {
          await getPrisma().waitlistEntry.update({
            where: { id: entry.id },
            data: { active: true },
          });
          continue;
        }

        await getPrisma().waitlistEntry.update({
          where: { id: entry.id },
          data: { notifiedAt: new Date() },
        });
        notified++;
      } catch (e) {
        // A throw AFTER the claim (e.g. transient DB error in sendMessage's
        // row update) must release the claim: the entry was never notified,
        // so it keeps its place for the next opportunity. Guarded to only
        // resurrect an un-notified entry — never one another path consumed.
        try {
          await getPrisma().waitlistEntry.updateMany({
            where: { id: entry.id, active: false, notifiedAt: null },
            data: { active: true },
          });
        } catch {
          // Restoration itself failed — report and move on; the entry stays
          // consumed rather than risking a double-notify on retry.
        }
        // PII-safe: entry id only, never the patient or the error object
        // (a Prisma/provider error can serialize field values).
        reportError("waitlist_notify_entry_failed", e);
      }
    }
    return notified;
  } catch (e) {
    reportError("waitlist_handle_failed", e);
    return 0;
  }
}

/**
 * Subscribe to slot-freed events. Returns an unsubscribe function.
 * The handler's promise is returned (NOT fire-and-forget): production emit
 * paths await it via `emitSlotFreedAsync`, so a notification can never be
 * silently dropped by a frozen serverless isolate. `handleSlotFreed` never
 * throws — and the async emitter guards handlers anyway.
 */
export function subscribeWaitlist(): () => void {
  return onSlotFreed((event) => handleSlotFreed(event));
}
