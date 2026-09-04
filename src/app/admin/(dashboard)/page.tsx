import { getPrisma } from "@/lib/db";
import {
  addClinicDays,
  CLINIC_TIMEZONE,
  clinicNoon,
  getClinicDayBoundsUTC,
  getClinicDayOfWeek,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";
import { computeKpis, getClinicWeekRange } from "@/lib/kpis/aggregations";
import { getStaffFromCookies } from "@/lib/auth/guard";
import KpiCards from "@/components/admin/KpiCards";
import DashboardHeader from "@/components/admin/DashboardHeader";
import DashboardClient from "@/components/admin/DashboardClient";
import "./dashboard.css";

// Dashboard home: dentist-first briefing + week at the chair.
// Server keeps the KPI aggregates (no PII, no audit row needed); the bento
// body (week strip / call queue / SMS pulse) fetches its audited reads
// client-side through the existing APIs + the new range endpoint — one
// range fetch total. "Today", greetings and every boundary go through
// lib/time/clinicTime.ts — never the server's or browser's timezone.

function formatDayLabel(localDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(clinicNoon(localDate));
}

function greetingFor(now: Date, name: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: CLINIC_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(now)
      .slice(0, 2),
  );
  const hello = hour < 18 ? "Bonjour" : "Bonsoir";
  return name ? `${hello}, ${name.split(" ")[0]}` : hello;
}

export default async function DashboardHome() {
  const prisma = getPrisma();
  const now = new Date();
  const todayLocal = toClinicLocalDateString(now);
  const { from, to } = getClinicWeekRange(todayLocal);
  const { startUTC: fromStart } = getClinicDayBoundsUTC(from);
  const { endUTC: toEnd } = getClinicDayBoundsUTC(to);
  const tomorrowLocal = addClinicDays(todayLocal, 1);
  const { startUTC: tomorrowStart } = getClinicDayBoundsUTC(tomorrowLocal);
  const { endUTC: tomorrowEnd } = getClinicDayBoundsUTC(tomorrowLocal);

  const [appointments, patients, workingHoursSetting, globalPending, tomorrowCount, staff] =
    await Promise.all([
      prisma.appointment.findMany({
        where: { startTime: { gte: fromStart, lte: toEnd } },
        select: {
          status: true,
          source: true,
          startTime: true,
          endTime: true,
          createdAt: true,
          confirmedAt: true,
          cancelReason: true,
        },
      }),
      prisma.patient.findMany({
        where: { createdAt: { gte: fromStart, lte: toEnd } },
        select: { createdAt: true },
      }),
      prisma.setting.findUnique({ where: { key: "workingHours" } }),
      // The call queue is global (every PENDING awaiting a call), not just
      // this week's — same number as /api/admin/appointments/pending.
      prisma.appointment.count({ where: { status: "PENDING" } }),
      prisma.appointment.count({
        where: {
          startTime: { gte: tomorrowStart, lte: tomorrowEnd },
          status: { notIn: ["CANCELLED", "RESCHEDULED"] },
        },
      }),
      getStaffFromCookies(),
    ]);

  // Note: the dashboard's "En attente d'appel" card is the GLOBAL call
  // queue (every PENDING awaiting a call, like /api/admin/appointments/pending),
  // while GET /api/admin/kpis returns the week's slice — same KpiCards label,
  // different scope by design (the API has no view of the global queue).
  // On Fridays the week shown is the previous completed Sat→Thu, so
  // "Rendez-vous aujourd'hui" (Friday, closed) reads 0 by design.
  const weekKpis = computeKpis({
    appointments,
    patients,
    workingHours: (workingHoursSetting?.value ?? {}) as unknown,
    from,
    to,
    today: todayLocal,
  });
  const kpis = { ...weekKpis, pendingCount: globalPending };

  const rangeLabel =
    from === to
      ? `Journée du ${formatDayLabel(from)}`
      : `Semaine du ${formatDayLabel(from)} au ${formatDayLabel(to)}`;
  const isFridayClosed = getClinicDayOfWeek(todayLocal) === "fri";

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4">
      <DashboardHeader
        greeting={greetingFor(now, staff?.name ?? null)}
        nowISO={now.toISOString()}
        todayCount={kpis.todayCount}
        pendingCount={globalPending}
        tomorrowCount={tomorrowCount}
        utilizationRate={kpis.utilizationRate}
        isFridayClosed={isFridayClosed}
        rangeLabel={rangeLabel}
      />

      <div className="dash-enter" style={{ animationDelay: "60ms" }}>
        <KpiCards kpis={kpis} rangeLabel={rangeLabel} />
      </div>

      <DashboardClient from={from} to={to} today={todayLocal} />

      <p className="pb-2 text-xs text-slate-400">
        Semaine clinique du samedi au jeudi (vendredi fermé). Les taux sont
        calculés sur cette période. Heures affichées en heure du cabinet
        (Africa/Algiers).
      </p>
    </div>
  );
}
