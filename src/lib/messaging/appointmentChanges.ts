import { getPrisma } from "@/lib/db";
import { SmsMessageType, SmsStatus } from "@/generated/prisma/client";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import {
  formatClinicLocalTime,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";
import { createSelfServiceToken } from "@/lib/selfservice/tokens";
import { buildSelfServiceLink } from "@/lib/selfservice/link";
import { sendMessage } from "./index";

// Patient-facing messages for appointment CHANGES (Task 8):
//
// - confirmation  — sent when staff confirms after the phone call (Task 14
//   calls this); carries the self-service link.
// - cancelled     — sent when the appointment is cancelled (patient via link,
//   or staff, or auto-expiry in Task 9).
// - reschedule    — sent after a move; carries the ROTATED link for the NEW
//   appointment.
//
// Templates are French-only for now (Task 7 decision). Messaging failures
// never propagate — a message that fails to send must not fail the cancel or
// reschedule it accompanies.

async function loadContext(appointmentId: string) {
  return getPrisma().appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true, service: true },
  });
}

function localParts(utc: Date): { date: string; time: string } {
  const [y, m, d] = toClinicLocalDateString(utc).split("-");
  return { date: `${d}/${m}/${y}`, time: formatClinicLocalTime(utc) };
}

/**
 * Send the confirmation message carrying the self-service link.
 *
 * Creates the token (rotating any previous live one) and sends the
 * CONFIRMATION SMS. Idempotent: if a CONFIRMATION message already exists for
 * this appointment it is a retry of the same logical confirmation — we do NOT
 * rotate the token (that would revoke the patient's working link) and do NOT
 * re-message. Returns the raw token (for tests/link building) or null when
 * nothing was sent.
 */
export async function sendAppointmentConfirmation(
  appointmentId: string,
): Promise<string | null> {
  const appointment = await loadContext(appointmentId);
  if (!appointment) return null;

  const alreadySent = await getPrisma().smsMessage.findFirst({
    where: { appointmentId, type: SmsMessageType.CONFIRMATION },
  });
  if (alreadySent?.status === SmsStatus.SENT) return null;

  const { rawToken } = await createSelfServiceToken(appointmentId);
  await sendMessage({
    type: SmsMessageType.CONFIRMATION,
    patientId: appointment.patientId,
    to: appointment.patient.phoneE164,
    appointmentId: appointment.id,
    templateKey: "confirmation",
    vars: {
      firstName: appointment.patient.firstName,
      serviceName: localized(appointment.service.name as LocalizedField, "fr"),
      ...localParts(appointment.startTime),
      selfServiceLink: buildSelfServiceLink(
        rawToken,
        appointment.patient.preferredLocale,
      ),
    },
  });
  return rawToken;
}

/** Send the cancellation message to the patient. Idempotent via the
 * `(appointmentId, CANCELLED)` unique index. */
export async function sendAppointmentCancelled(
  appointmentId: string,
): Promise<void> {
  const appointment = await loadContext(appointmentId);
  if (!appointment) return;

  await sendMessage({
    type: SmsMessageType.CANCELLED,
    patientId: appointment.patientId,
    to: appointment.patient.phoneE164,
    appointmentId: appointment.id,
    templateKey: "cancelled",
    vars: {
      firstName: appointment.patient.firstName,
      serviceName: localized(appointment.service.name as LocalizedField, "fr"),
      ...localParts(appointment.startTime),
    },
  });
}

/**
 * Send the reschedule message carrying the ROTATED self-service link for the
 * new appointment. Keyed to the OLD appointmentId (the message is about that
 * appointment's move). Returns the new raw token, or null when nothing sent.
 */
export async function sendAppointmentRescheduled(
  oldAppointmentId: string,
  newAppointmentId: string,
): Promise<string | null> {
  const [old, neu] = await Promise.all([
    loadContext(oldAppointmentId),
    loadContext(newAppointmentId),
  ]);
  if (!old || !neu) return null;

  const alreadySent = await getPrisma().smsMessage.findFirst({
    where: { appointmentId: oldAppointmentId, type: SmsMessageType.RESCHEDULE },
  });
  if (alreadySent?.status === SmsStatus.SENT) return null;

  const { rawToken } = await createSelfServiceToken(newAppointmentId);
  await sendMessage({
    type: SmsMessageType.RESCHEDULE,
    patientId: neu.patientId,
    to: neu.patient.phoneE164,
    appointmentId: oldAppointmentId,
    templateKey: "reschedule",
    vars: {
      firstName: neu.patient.firstName,
      serviceName: localized(neu.service.name as LocalizedField, "fr"),
      oldDate: localParts(old.startTime).date,
      oldTime: localParts(old.startTime).time,
      newDate: localParts(neu.startTime).date,
      newTime: localParts(neu.startTime).time,
      selfServiceLink: buildSelfServiceLink(
        rawToken,
        neu.patient.preferredLocale,
      ),
    },
  });
  return rawToken;
}