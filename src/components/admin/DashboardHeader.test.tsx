// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DashboardHeader from "./DashboardHeader";

describe("DashboardHeader", () => {
  it("renders greeting, counts, clinic clock and Friday banner", () => {
    render(
      <DashboardHeader
        greeting="Bonjour"
        nowISO={new Date().toISOString()}
        todayCount={6}
        pendingCount={3}
        tomorrowCount={4}
        utilizationRate={0.72}
        isFridayClosed={true}
        rangeLabel="Semaine du sam. 30 août au jeu. 4 sept."
      />,
    );
    expect(screen.getByRole("heading", { name: "Bonjour" })).toBeInTheDocument();
    expect(screen.getByRole("timer")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
    expect(screen.getByText(/aujourd'hui/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ouvrir l'agenda/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /File d'appels \(3\)/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/fermé le vendredi/i);
    expect(screen.getByRole("img", { name: /72 pour cent/ })).toBeInTheDocument();
  });

  it("handles null utilization without NaN", () => {
    render(
      <DashboardHeader
        greeting="Bonsoir"
        nowISO={new Date().toISOString()}
        todayCount={0}
        pendingCount={0}
        tomorrowCount={0}
        utilizationRate={null}
        isFridayClosed={false}
        rangeLabel="x"
      />,
    );
    expect(screen.getByRole("img", { name: /non disponible/ })).toBeInTheDocument();
  });
});
