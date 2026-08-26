import { getPrisma } from "@/lib/db";
import { NotificationType } from "@/generated/prisma/client";

// Staff in-app notification feed (plan.md §Domain model — `Notification`).
// Fan-out rule: one row per ACTIVE staff user, so nothing depends on a
// particular person being logged in.

export type NewBookingNotificationPayload = {
  appointmentId: string;
  patientName: string;
  serviceId: string;
  /** Full per-locale service name, so the dashboard can render any language. */
  serviceName: Record<string, string>;
  /** Appointment start, ISO-8601 UTC. */
  startTime: string;
};

/** Create a NEW_BOOKING notification for every active staff user. Returns the
 * number of rows created (0 when there are no active staff). */
export async function notifyNewBooking(
  payload: NewBookingNotificationPayload,
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
      type: NotificationType.NEW_BOOKING,
      payload,
    })),
  });
  return count;
}

export type CancellationNotificationPayload = {
  appointmentId: string;
  patientName: string;
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
export async function notifyCancellation(
  payload: CancellationNotificationPayload,
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
      type: NotificationType.CANCELLATION,
      payload,
    })),
  });
  return count;
}