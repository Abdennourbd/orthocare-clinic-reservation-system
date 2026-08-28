import { getPrisma } from "@/lib/db";
import { toClinicLocalDateString, getClinicDayBoundsUTC } from "@/lib/time/clinicTime";

// Task 12 — dashboard home (placeholder). Real KPIs land in Task 18
// (`GET /api/admin/kpis`); this page only proves the shell + session guard.

export default async function DashboardHome() {
  const prisma = getPrisma();
  // "Today" means the clinic's today (Africa/Algiers), never the server's —
  // day boundaries always go through lib/time/clinicTime.ts (plan.md §Timezone).
  const todayLocal = toClinicLocalDateString(new Date());
  const { startUTC, endUTC } = getClinicDayBoundsUTC(todayLocal);
  const [pendingCount, todayAppointments] = await Promise.all([
    prisma.appointment.count({ where: { status: "PENDING" } }),
    prisma.appointment.count({
      where: {
        startTime: { gte: startUTC, lt: endUTC },
        status: { notIn: ["CANCELLED"] },
      },
    }),
  ]);

  const cards = [
    { label: "Rendez-vous aujourd'hui", value: todayAppointments },
    { label: "En attente d'appel", value: pendingCount },
    { label: "Nouveaux patients (mois)", value: "—" },
    { label: "Taux d'occupation", value: "—" },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Tableau de bord</h1>
        <p className="text-sm text-slate-500">
          Vue d&apos;ensemble de l&apos;activité de la clinique.
        </p>
      </header>

      <section aria-label="Indicateurs clés" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{card.value}</p>
          </div>
        ))}
      </section>

      <p className="text-sm text-slate-400">
        Les indicateurs détaillés (taux de no-show, part des réservations en
        ligne, délai de confirmation) arrivent avec le module KPI.
      </p>
    </div>
  );
}
