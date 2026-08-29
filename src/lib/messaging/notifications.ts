import { getPrisma } from "@/lib/db";
import { NotificationType, type Prisma } from "@/generated/prisma/client";

// Staff in-app notification feed (plan.md §Domain model — `Notification`).
// Fan-out rule: one row per ACTIVE staff user, so nothing depends on a
// particular person being logged in.
//
// task-13.md étape 6, TOUR 2 [CRITIQUE]: payloads carry NO patient-identifying
// field (no `patientName`) — only `appointmentId` plus non-identifying
// scheduling data. `Notification` has no FK to `Patient` (createMany writes
// a plain JSON blob), so neither the anonymize.ts cascade nor any future
// hard-delete could ever reach a name baked into this table. Keeping the
// payload name-free makes erasure automatically effective here instead of
// relying on someone remembering to scrub Notification rows too. The screen
// that will eventually list these notifications must resolve the patient's
// name by joining on `appointmentId` at render time, not by reading it back
// out of `payload`.

/** Fan out one notification row to every active staff user. Returns the
 * number of rows created (0 when there are no active staff). */
async function fanOut<T extends object>(
  type: NotificationType,
  payload: T,
): Promise<number> {
  const prisma = getPrisma();
  const staff = await prisma.user.findMany({
    where: { active: true },
    select: { id: true },
  });
  if (staff.length === 0) return 0;

  const { count } = await prisma.notification.createMany({
    data: staff.map((u) => ({
      userId: u.id,
      type,
      payload: payload as Prisma.InputJsonValue,
    })),
  });
  return count;
}

export type NewBookingNotificationPayload = {
  appointmentId: string;
  serviceId: string;
  /** Full per-locale service name, so the dashboard can render any language. */
  serviceName: Record<string, string>;
  /** Appointment start, ISO-8601 UTC. */
  startTime: string;
};

/** Create a NEW_BOOKING notification for every active staff user. */
export function notifyNewBooking(
  payload: NewBookingNotificationPayload,
): Promise<number> {
  return fanOut(NotificationType.NEW_BOOKING, payload);
}

export type CancellationNotificationPayload = {
  appointmentId: string;
  serviceId: string;
  /** Full per-locale service name, so the dashboard can render any language. */
  serviceName: Record<string, string>;
  /** Appointment start, ISO-8601 UTC. */
  startTime: string;
  /** What freed the slot: patient via link, staff, auto-expiry, closure. */
  reason: string;
};

/** Create a CANCELLATION notification for every active staff user — a slot
 * freed (patient cancelled via link, staff cancelled, auto-expired, closure).
 * Same fan-out rule as NEW_BOOKING. */
export function notifyCancellation(
  payload: CancellationNotificationPayload,
): Promise<number> {
  return fanOut(NotificationType.CANCELLATION, payload);
}

export type NoShowAlertPayload = {
  appointmentId: string;
  serviceId: string;
  /** Full per-locale service name, so the dashboard can render any language. */
  serviceName: Record<string, string>;
  /** Appointment start, ISO-8601 UTC. */
  startTime: string;
};

/** Create a NO_SHOW_ALERT notification for every active staff user (Task 9
 * no-show-followup cron). */
export function notifyNoShowAlert(
  payload: NoShowAlertPayload,
): Promise<number> {
  return fanOut(NotificationType.NO_SHOW_ALERT, payload);
}

export type PendingExpiredPayload = {
  appointmentId: string;
  serviceId: string;
  /** Full per-locale service name, so the dashboard can render any language. */
  serviceName: Record<string, string>;
  /** Appointment start, ISO-8601 UTC. */
  startTime: string;
  /** `AUTO_EXPIRED` — the only reason the expiry cron uses. */
  cancelReason: string;
};

/** Create a PENDING_EXPIRED notification for every active staff user (Task 9
 * expire-pending cron). */
export function notifyPendingExpired(
  payload: PendingExpiredPayload,
): Promise<number> {
  return fanOut(NotificationType.PENDING_EXPIRED, payload);
}
