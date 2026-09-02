import { getPrisma } from "@/lib/db";
import {
  AppointmentStatus,
  AuditAction,
  AuditActorType,
  SmsMessageType,
  SmsStatus,
  type SmsBroadcast,
} from "@/generated/prisma/client";
import { sendMessage } from "./index";
import { readMessageTemplate, renderTemplate } from "./templates";
import {
  clinicNoon,
  formatClinicLocalTime,
  getClinicDayBoundsUTC,
} from "@/lib/time/clinicTime";
import { logAction } from "@/lib/audit/logAction";

// Task 16 — SMS Center domain: the day-view delay broadcast.
//
// A broadcast is "today's appointments are running X minutes late": one
// SmsBroadcast batch row + one DELAY SmsMessage per eligible recipient,
// stamped with `batchId` so the dashboard can group them. Eligibility is
// decided by splitAudience (pure, unit-tested) — the routes never re-derive
// it. The batch row is created BEFORE the sends, keyed by a unique
// idempotencyKey: a retried double-click hits P2002 and gets the existing
// batch back with ZERO sends, so the patients are never messaged twice even
// though the sends themselves are not wrapped in a transaction (external I/O
// can't be). Never passing `appointmentId` to sendMessage is deliberate: the
// (appointmentId, type) unique index would otherwise block a second delay
// broadcast on the same day (see SmsMessage comment in schema.prisma).

export type BroadcastRecipient = {
  appointmentId: string;
  patientId: string;
  firstName: string;
  lastName: string;
  /** The patient's E.164 number (`patient.phoneE164`). */
  phone: string;
  startTime: Date;
};

export type BroadcastExclusionReason =
  | "CANCELLED"
  | "RESCHEDULED"
  | "COMPLETED"
  | "NO_SHOW"
  | "OPTED_OUT"
  | "INACTIVE";

export type BroadcastAudience = {
  recipients: BroadcastRecipient[];
  excluded: Array<{ appointmentId: string; reason: BroadcastExclusionReason }>;
};

/** Minimal shape loadAudience feeds into splitAudience — the subset of
 * Appointment (+ patient) the audience split needs, so tests can build
 * fixtures without the full model. */
export type AppointmentWithPatient = {
  id: string;
  status: AppointmentStatus;
  startTime: Date;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    phoneE164: string;
    active: boolean;
    messagingOptOut: boolean;
    anonymizedAt: Date | null;
  };
};

/** Appointment status → broadcast exclusion reason. PENDING/CONFIRMED are the
 * only statuses that reach the patient check, so they are absent here. */
const STATUS_EXCLUSION: Partial<
  Record<AppointmentStatus, BroadcastExclusionReason>
> = {
  [AppointmentStatus.CANCELLED]: "CANCELLED",
  [AppointmentStatus.RESCHEDULED]: "RESCHEDULED",
  [AppointmentStatus.COMPLETED]: "COMPLETED",
  [AppointmentStatus.NO_SHOW]: "NO_SHOW",
};

/**
 * Split a day's appointments into broadcast recipients and exclusions.
 *
 * PURE. Recipients = status PENDING or CONFIRMED with an active,
 * non-anonymized, non-opted-out patient. Everything else lands in `excluded`
 * with exactly one reason: first the status reasons (CANCELLED / RESCHEDULED
 * / COMPLETED / NO_SHOW), then patient reasons (OPTED_OUT when
 * `messagingOptOut`, else INACTIVE when `!active || anonymizedAt`). Input
 * order is preserved in both lists.
 */
export function splitAudience(
  appointments: AppointmentWithPatient[],
): BroadcastAudience {
  const recipients: BroadcastRecipient[] = [];
  const excluded: BroadcastAudience["excluded"] = [];

  for (const a of appointments) {
    const statusReason = STATUS_EXCLUSION[a.status];
    if (statusReason) {
      excluded.push({ appointmentId: a.id, reason: statusReason });
      continue;
    }
    if (a.patient.messagingOptOut) {
      excluded.push({ appointmentId: a.id, reason: "OPTED_OUT" });
      continue;
    }
    if (!a.patient.active || a.patient.anonymizedAt) {
      excluded.push({ appointmentId: a.id, reason: "INACTIVE" });
      continue;
    }
    recipients.push({
      appointmentId: a.id,
      patientId: a.patient.id,
      firstName: a.patient.firstName,
      lastName: a.patient.lastName,
      phone: a.patient.phoneE164,
      startTime: a.startTime,
    });
  }

  return { recipients, excluded };
}

/**
 * Load the broadcast audience for a clinic-local date (YYYY-MM-DD): every
 * appointment of that day, ordered by start time, split by splitAudience.
 */
export async function loadAudience(date: string): Promise<BroadcastAudience> {
  const prisma = getPrisma();
  const { startUTC, endUTC } = getClinicDayBoundsUTC(date);
  const appointments = await prisma.appointment.findMany({
    where: { startTime: { gte: startUTC, lte: endUTC } },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      status: true,
      startTime: true,
      patient: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneE164: true,
          active: true,
          messagingOptOut: true,
          anonymizedAt: true,
        },
      },
    },
  });
  return splitAudience(appointments);
}

/**
 * Preview payload for the broadcast UI: the audience for `date` plus a SAMPLE
 * body rendered from the (admin-editable) delay template with placeholder-ish
 * values ("Jean", the day's noon, 30 min). Per-patient bodies differ — each
 * recipient gets their own first name and slot time — so this sample is for
 * tone/wording approval only, never a verbatim preview of what anyone receives.
 */
export async function previewBroadcast(
  date: string,
): Promise<BroadcastAudience & { sampleBody: string; date: string }> {
  const audience = await loadAudience(date);
  const template = await readMessageTemplate("delay");
  const sampleBody = renderTemplate(template, {
    firstName: "Jean",
    time: formatClinicLocalTime(clinicNoon(date)),
    delayMinutes: 30,
  });
  return { ...audience, sampleBody, date };
}

/**
 * Run the delay broadcast for `date` with `delayMinutes`.
 *
 * Algorithm:
 *  1. loadAudience → recipientCount.
 *  2. Create the SmsBroadcast row (unique idempotencyKey). On P2002 the batch
 *     was already sent — return the existing row's counts with
 *     `alreadySent: true` and ZERO sends.
 *  3. Send sequentially (NOT Promise.all — one provider request at a time is
 *     gentle on the provider's rate limits; a whole clinic's phones firing at
 *     once would trip them). The dispatcher owns the opt-out gate: DELAY is
 *     non-transactional, so opted-out/inactive patients come back as null.
 *  4. Persist the three counters on the batch row.
 *  5. Audit (ids/counters/enums only — never names/phones/bodies).
 *
 * Create-then-send means a crash mid-send leaves the batch with partial
 * counts — acceptable for v1: the idempotency key still prevents a resend by
 * a retrying client, and the counter update makes the partial state visible.
 */
export async function runBroadcast(input: {
  date: string;
  delayMinutes: number;
  idempotencyKey: string;
  sentById: string;
}): Promise<{
  batchId: string;
  sentCount: number;
  suppressedCount: number;
  failedCount: number;
  alreadySent: boolean;
}> {
  const prisma = getPrisma();
  const audience = await loadAudience(input.date);
  const recipientCount = audience.recipients.length;

  let broadcast: SmsBroadcast;
  try {
    broadcast = await prisma.smsBroadcast.create({
      data: {
        date: input.date,
        delayMinutes: input.delayMinutes,
        idempotencyKey: input.idempotencyKey,
        recipientCount,
        sentById: input.sentById,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const existing = await prisma.smsBroadcast.findFirst({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return {
          batchId: existing.id,
          sentCount: existing.sentCount,
          suppressedCount: existing.suppressedCount,
          failedCount: existing.failedCount,
          alreadySent: true,
        };
      }
    }
    throw e;
  }

  let sentCount = 0;
  let suppressedCount = 0;
  let failedCount = 0;
  for (const recipient of audience.recipients) {
    // NEVER pass appointmentId here: the (appointmentId, type) unique index
    // would turn a second delay broadcast on the same day into silent
    // no-ops (see SmsMessage comment in schema.prisma).
    const message = await sendMessage({
      type: SmsMessageType.DELAY,
      patientId: recipient.patientId,
      to: recipient.phone,
      batchId: broadcast.id,
      sentById: input.sentById,
      templateKey: "delay",
      vars: {
        firstName: recipient.firstName,
        time: formatClinicLocalTime(recipient.startTime),
        delayMinutes: String(input.delayMinutes),
      },
    });
    if (message === null) {
      // Opted-out or inactive — suppressed by the dispatcher, no row.
      suppressedCount++;
    } else if (message.status === SmsStatus.FAILED) {
      failedCount++;
    } else {
      sentCount++;
    }
  }

  await prisma.smsBroadcast.update({
    where: { id: broadcast.id },
    data: { sentCount, suppressedCount, failedCount },
  });

  await logAction(
    { type: AuditActorType.STAFF, userId: input.sentById },
    AuditAction.SMS_SENT,
    "SmsBroadcast",
    broadcast.id,
    {
      date: input.date,
      delayMinutes: input.delayMinutes,
      recipientCount,
      sentCount,
      suppressedCount,
      failedCount,
    },
  );

  return {
    batchId: broadcast.id,
    sentCount,
    suppressedCount,
    failedCount,
    alreadySent: false,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}
