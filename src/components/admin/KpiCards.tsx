import type { KpiResult } from "@/lib/kpis/aggregations";

// Task 18 — dashboard KPI cards (FR-only). Presentational: the server page
// fetches the aggregates, this renders them. Same card shell as the Task 12
// placeholder (rounded border, no gradients) so the dashboard stays visually
// consistent; null rates render as "—", never NaN.

export function formatPercent(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

export function formatMedian(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest}`;
}

export default function KpiCards({
  kpis,
  rangeLabel,
}: {
  kpis: KpiResult;
  rangeLabel: string;
}) {
  const cards: Array<{ label: string; value: string | number }> = [
    { label: "Rendez-vous aujourd'hui", value: kpis.todayCount },
    { label: "En attente d'appel", value: kpis.pendingCount },
    { label: "Nouveaux patients", value: kpis.newPatients },
    { label: "Taux d'occupation", value: formatPercent(kpis.utilizationRate) },
    { label: "Taux de no-show", value: formatPercent(kpis.noShowRate) },
    {
      label: "Part des réservations en ligne",
      value: formatPercent(kpis.onlineShare),
    },
    {
      label: "Délai médian de confirmation",
      value: formatMedian(kpis.medianConfirmMinutes),
    },
    {
      label: "Taux d'expiration auto",
      value: formatPercent(kpis.autoExpiryRate),
    },
  ];

  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-500">{rangeLabel}</p>
      <section
        aria-label="Indicateurs clés"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">
              {card.value}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}
