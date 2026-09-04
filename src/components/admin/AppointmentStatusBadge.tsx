import { STATUS_LABELS, type AppointmentStatus } from "./appointmentTypes";

// Task 14 step 5 — status badge: color + TEXT, never color alone (WCAG).
// Each pair bg-…-100 / text-…-900 keeps a contrast ratio well above 4.5:1.

const STATUS_CLASSES: Record<AppointmentStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900",
  CONFIRMED: "bg-teal-100 text-teal-900",
  COMPLETED: "bg-emerald-100 text-emerald-900",
  NO_SHOW: "bg-red-100 text-red-900",
  CANCELLED: "bg-slate-200 text-slate-800",
  RESCHEDULED: "bg-sky-100 text-sky-900",
};

export default function AppointmentStatusBadge({ status }: { status: string }) {
  const key = status as AppointmentStatus;
  const classes = STATUS_CLASSES[key] ?? "bg-slate-200 text-slate-800";
  const label = STATUS_LABELS[key] ?? status;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}
