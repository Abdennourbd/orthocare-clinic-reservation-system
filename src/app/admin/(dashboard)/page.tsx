import { getPrisma } from "@/lib/db";
import {
  clinicNoon,
  getClinicDayBoundsUTC,
  toClinicLocalDateString,
} from "@/lib/time/clinicTime";
import { computeKpis, getClinicWeekRange } from "@/lib/kpis/aggregations";
import KpiCards from "@/components/admin/KpiCards";

// Task 18 — dashboard home: today's schedule + the current Sat→Thu clinic
// week's success metrics (plan.md §Success Metrics), computed on demand from
// appointments (no extra tables). "Today" and every day boundary go through
// lib/time/clinicTime.ts — never the server's timezone.

function formatDayLabel(localDate: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Algiers",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(clinicNoon(localDate));
}

export default async function DashboardHome() {
  const prisma = getPrisma();
  const todayLocal = toClinicLocalDateString(new Date());
  const { from, to } = getClinicWeekRange(todayLocal);
  const { startUTC: fromStart } = getClinicDayBoundsUTC(from);
  const { endUTC: toEnd } = getClinicDayBoundsUTC(to);

  const [appointments, patients, workingHoursSetting, globalPending] =
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
    ]);

  const kpis = computeKpis({
    appointments,
    patients,
    workingHours: (workingHoursSetting?.value ?? {}) as unknown,
    from,
    to,
    today: todayLocal,
  });
  // "En attente d'appel" is the global queue, not the week's slice.
  kpis.pendingCount = globalPending;

  const rangeLabel =
    from === to
      ? `Journée du ${formatDayLabel(from)}`
      : `Semaine du ${formatDayLabel(from)} au ${formatDayLabel(to)}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Tableau de bord</h1>
        <p className="text-sm text-slate-500">
          Vue d&apos;ensemble de l&apos;activité de la clinique.
        </p>
      </header>

      <KpiCards kpis={kpis} rangeLabel={rangeLabel} />

      <p className="text-sm text-slate-400">
        Semaine clinique du samedi au jeudi (vendredi fermé). Les taux sont
        calculés sur cette période.
      </p>
    </div>
  );
}
