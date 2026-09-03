// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import KpiCards from "./KpiCards";

// Task 18 — KpiCards presentational tests: French labels, null → "—",
// French number formatting. Mirrors ManualSmsForm.test.tsx conventions.

const BASE_KPIS = {
  from: "2026-08-29",
  to: "2026-09-03",
  total: 6,
  pendingCount: 1,
  todayCount: 2,
  newPatients: 3,
  bookedMinutes: 120,
  openMinutes: 2520,
  utilizationRate: 120 / 2520,
  noShowRate: 0.5,
  onlineShare: 5 / 6,
  autoExpiryRate: 0.2,
  medianConfirmMinutes: 90,
};

afterEach(() => {
  cleanup();
});

describe("KpiCards", () => {
  it("renders the eight week indicators with French labels", () => {
    render(<KpiCards kpis={BASE_KPIS} rangeLabel="29 août – 3 sept." />);
    for (const label of [
      "Rendez-vous aujourd'hui",
      "En attente d'appel",
      "Nouveaux patients",
      "Taux d'occupation",
      "Taux de no-show",
      "Part des réservations en ligne",
      "Délai médian de confirmation",
      "Taux d'expiration auto",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // Formatted values: median 90 min → "1 h 30", counts as-is.
    expect(screen.getByText("1 h 30")).toBeTruthy();
    expect(screen.getByText("29 août – 3 sept.")).toBeTruthy();
  });

  it("renders a dash for every null rate (empty week, never NaN)", () => {
    render(
      <KpiCards
        kpis={{
          ...BASE_KPIS,
          utilizationRate: null,
          noShowRate: null,
          onlineShare: null,
          autoExpiryRate: null,
          medianConfirmMinutes: null,
        }}
        rangeLabel="semaine"
      />,
    );
    // 4 null rates + 1 null median = 5 dashes.
    expect(screen.getAllByText("—")).toHaveLength(5);
  });
});
