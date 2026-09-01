// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AppointmentStatusBadge from "./AppointmentStatusBadge";
import AppointmentActions from "./AppointmentActions";

// Task 14 step 5 — two cheap-but-meaningful render assertions: the badge
// always carries TEXT (never color alone), and the action set mirrors the
// API's transition map (CONFIRM on PENDING only, COMPLETE/NO_SHOW on
// CONFIRMED only, nothing on terminal statuses). The backend transitions
// themselves are already fully tested; this only pins the UI's mirroring of
// them.

describe("AppointmentStatusBadge", () => {
  it.each([
    ["PENDING", "En attente"],
    ["CONFIRMED", "Confirmé"],
    ["COMPLETED", "Terminé"],
    ["NO_SHOW", "Absent"],
    ["CANCELLED", "Annulé"],
    ["RESCHEDULED", "Reporté"],
  ])("renders %s as a text label", (status, label) => {
    render(<AppointmentStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    cleanup();
  });

  it("falls back to the raw status for an unknown value", () => {
    render(<AppointmentStatusBadge status="SOMETHING_ELSE" />);
    expect(screen.getByText("SOMETHING_ELSE")).toBeInTheDocument();
    cleanup();
  });
});

describe("AppointmentActions — visibility mirrors the transition map", () => {
  const baseProps = {
    appointmentId: "appt-1",
    startTime: "2026-09-01T09:00:00.000Z",
    onUpdated: () => {},
  };

  afterEach(cleanup);

  it("PENDING offers Confirmer / Annuler / Reporter but not Terminé/Absent", () => {
    render(<AppointmentActions {...baseProps} status="PENDING" />);
    expect(screen.getByRole("button", { name: "Confirmer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reporter" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Terminé" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Absent" })).not.toBeInTheDocument();
  });

  it("CONFIRMED offers Terminé / Absent / Annuler / Reporter but not Confirmer", () => {
    render(<AppointmentActions {...baseProps} status="CONFIRMED" />);
    expect(screen.getByRole("button", { name: "Terminé" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Absent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmer" })).not.toBeInTheDocument();
  });

  it("terminal statuses offer no action buttons", () => {
    for (const status of ["COMPLETED", "NO_SHOW", "CANCELLED", "RESCHEDULED"]) {
      render(<AppointmentActions {...baseProps} status={status} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      cleanup();
    }
  });

  it("Annuler requires an inline confirmation before firing", () => {
    const onUpdated = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<AppointmentActions {...baseProps} status="CONFIRMED" onUpdated={onUpdated} />);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    // The two-step gate replaces the single click with an explicit confirm —
    // nothing is sent to the API until "Oui, annuler" is pressed.
    expect(screen.getByRole("button", { name: "Oui, annuler" })).toBeInTheDocument();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
