import {
  formatClinicLocalTime,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";

// Formats a UTC instant into the clinic-local parts used in message
// templates: `date` as DD/MM/YYYY and `time` as HH:mm (clinic-local).
// Shared by the patient-facing message senders (Task 8 confirmation/cancel/
// reschedule and Task 9 cron reminders/no-show/expiry) so every template
// renders the same local time regardless of the viewer's browser timezone.
export function localParts(utc: Date): { date: string; time: string } {
  const [y, m, d] = toClinicLocalDateString(utc).split("-");
  return { date: `${d}/${m}/${y}`, time: formatClinicLocalTime(utc) };
}