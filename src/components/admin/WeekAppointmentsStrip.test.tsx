// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import WeekAppointmentsStrip from "./WeekAppointmentsStrip";

const rows = [
  {
    id: "a1",
    startTime: "2026-09-01T09:00:00.000Z",
    endTime: "2026-09-01T09:30:00.000Z",
    status: "CONFIRMED",
    source: "ONLINE",
    patient: { id: "p1", firstName: "Lina", lastName: "Haddad", phone: "0550111222" },
    service: { id: "s1", name: { fr: "Consultation" }, durationMinutes: 30 },
  },
  {
    id: "a2",
    startTime: "2026-09-02T10:00:00.000Z",
    endTime: "2026-09-02T10:30:00.000Z",
    status: "PENDING",
    source: "MANUAL",
    patient: { id: "p2", firstName: "Yac", lastName: "Ben", phone: "0550999001" },
    service: { id: "s1", name: { fr: "Contrôle" }, durationMinutes: 30 },
  },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ appointments: rows }) }) as Response),
  );
});

describe("WeekAppointmentsStrip", () => {
  it("loads once, groups by day, day filter is client-side", async () => {
    const onPatients = vi.fn();
    render(
      <WeekAppointmentsStrip from="2026-08-29" to="2026-09-03" today="2026-09-01" onPatients={onPatients} />,
    );
    expect(await screen.findByText("Haddad Lina")).toBeInTheDocument();
    expect(screen.getByText("Ben Yac")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onPatients).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "p1" })]),
    );

    fireEvent.change(screen.getByLabelText("Jour"), { target: { value: "2026-09-02" } });
    // Client-side filter: no second network call.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Haddad Lina")).not.toBeInTheDocument();
    expect(screen.getByText("Ben Yac")).toBeInTheDocument();
  });

  it("status filter refetches with status param", async () => {
    render(<WeekAppointmentsStrip from="2026-08-29" to="2026-09-03" today="2026-09-01" />);
    await screen.findByText("Haddad Lina");
    fireEvent.change(screen.getByLabelText("État"), { target: { value: "PENDING" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toContain("status=PENDING");
  });

  it("shows error + retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false }) as Response),
    );
    render(<WeekAppointmentsStrip from="2026-08-29" to="2026-09-03" today="2026-09-01" />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
