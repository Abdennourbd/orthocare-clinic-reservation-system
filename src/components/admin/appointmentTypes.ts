// Task 14 step 5 — shared row shapes and FR labels for the appointment
// screens. These mirror the named-field select shapes of the admin
// appointment routes (src/app/api/admin/appointments/route.ts and siblings)
// — never a model spread on the wire, so the UI types exactly what it reads.

export const APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
  "RESCHEDULED",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface AppointmentPatientRef {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
}

export interface AppointmentServiceRef {
  id: string;
  name: string;
  durationMinutes: number;
}

/** Row shape of GET /api/admin/appointments?date=… and GET …/search?q=… */
export interface AppointmentRow {
  id: string;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  source: string;
  patient: AppointmentPatientRef;
  service: AppointmentServiceRef;
}

/** Row shape of GET /api/admin/appointments/pending (the call queue). */
export interface PendingAppointmentRow extends AppointmentRow {
  createdAt: string;
  expiresAt: string;
  msRemaining: number;
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: "En attente",
  CONFIRMED: "Confirmé",
  COMPLETED: "Terminé",
  NO_SHOW: "Absent",
  CANCELLED: "Annulé",
  RESCHEDULED: "Reporté",
};

export const SOURCE_LABELS: Record<string, string> = {
  ONLINE: "En ligne",
  MANUAL: "Manuel",
};
