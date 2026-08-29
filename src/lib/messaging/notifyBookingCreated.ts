import { getPrisma } from "@/lib/db";
import { SmsMessageType } from "@/generated/prisma/client";
import { localized, type LocalizedField } from "@/lib/i18n/localized";
import {
  toClinicLocalDateString,
  formatClinicLocalTime,
} from "@/lib/time/clinicTime";
import { sendMessage } from "./index";
import { notifyNewBooking } from "./notifications";

// After an ONLINE booking commits (Task 6's POST /api/appointments), this
// sends the patient the booking-received message ("request received, we will
// call to confirm") and fans out a NEW_BOOKING notification to every active
// staff member. Called OUTSIDE the booking transaction so a messaging or
// notification failure can never roll back a successful booking.
//
// The message is French-only for now (Task 7 decision); the patient's
// preferred locale is captured on `Patient.preferredLocale` for later tasks.

export async function notifyBookingCreated(appointmentId: string): Promise<void> {
  const prisma = getPrisma();
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: { patient: true, service: true },
  });
  if (!appointment) return;

  const start = appointment.startTime;
  const [y, m, d] = toClinicLocalDateString(start).split("-");

  await sendMessage({
    type: SmsMessageType.BOOKING_RECEIVED,
    patientId: appointment.patientId,
    to: appointment.patient.phoneE164,
    appointmentId: appointment.id,
    templateKey: "bookingReceived",
    vars: {
      firstName: appointment.patient.firstName,
      // French-only template → French service name.
      serviceName: localized(appointment.service.name as LocalizedField, "fr"),
      date: `${d}/${m}/${y}`,
      time: formatClinicLocalTime(start),
      phone: appointment.patient.phone,
    },
  });

  await notifyNewBooking({
    appointmentId: appointment.id,
    serviceId: appointment.serviceId,
    serviceName: appointment.service.name as unknown as Record<string, string>,
    startTime: start.toISOString(),
  });
}