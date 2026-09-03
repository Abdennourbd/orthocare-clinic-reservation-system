import type { Prisma } from "@/generated/prisma/client";
import { toClinicLocalDateString } from "@/lib/time/clinicTime";

// Task 17 — book-on-claim cleanup (user-approved box 6 ruling).
//
// When a waitlisted patient books the slot they were watching (same
// service + same clinic-local date), their ACTIVE entries for that
// service/date are deactivated in the SAME transaction as the booking.
// Without this, a watcher who books directly (saw the slot, never got
// notified) keeps a stale ACTIVE entry that fires a spurious SMS later.
//
// Rules:
// - Matches on patientId + serviceId + clinic-local date of startUTC
//   (same `toClinicLocalDateString` both sides as notifyWaitlist).
// - Sets active=false, notifiedAt stays NULL — claimed is distinct from
//   notified (notify sets notifiedAt). Lets staff tell "booked it" apart
//   from "was SMS'd".
// - Never throws: cleanup must never break a booking. Failures log + return 0.
// - Called from bookSlotInTx (single choke point: public booking,
//   admin manual booking, reschedules all flow through it).

export async function deactivateClaimedWaitlistEntries(
  tx: Prisma.TransactionClient,
  input: { patientId: string; serviceId: string; startUTC: Date },
): Promise<number> {
  try {
    const bookedLocalDate = toClinicLocalDateString(input.startUTC);
    const activeEntries = await tx.waitlistEntry.findMany({
      where: {
        patientId: input.patientId,
        serviceId: input.serviceId,
        active: true,
      },
      select: { id: true, preferredDates: true },
    });
    const claimedIds = activeEntries
      .filter((e) =>
        e.preferredDates.some(
          (d) => toClinicLocalDateString(d) === bookedLocalDate,
        ),
      )
      .map((e) => e.id);
    if (claimedIds.length === 0) return 0;
    await tx.waitlistEntry.updateMany({
      where: { id: { in: claimedIds } },
      data: { active: false },
    });
    return claimedIds.length;
  } catch (e) {
    console.error("waitlist claim cleanup failed", e);
    return 0;
  }
}
