// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import WaitlistList from "./WaitlistList";

// Task 17.3 — WaitlistList component tests, mirroring
// PatientDocuments.test.tsx delete-flow conventions (fetchOnce helper,
// vi.stubGlobal("fetch", …), jsdom). The list is pure presentation: rows come
// in as props from WaitlistDashboard (the container that owns the GET), and
// only the DELETE travels over the network from here.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    // Storage convention: each clinic-local date's UTC midnight
    // (Africa/Algiers is UTC+1, so 05/10 local == 04/10 23:00Z).
    preferredDates: ["2026-10-04T23:00:00.000Z", "2026-10-05T23:00:00.000Z"],
    source: "STAFF",
    active: true,
    notifiedAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    patient: {
      id: "p1",
      firstName: "Sofia",
      lastName: "Alaoui",
      phoneE164: "+213550123456",
      active: true,
      anonymizedAt: null,
    },
    service: {
      id: "s1",
      name: { fr: "Consultation générale", ar: null, en: null },
      slug: "consultation-generale",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("WaitlistList", () => {
  it("renders the empty state with role=status when there are no entries", () => {
    render(<WaitlistList entries={[]} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Aucune entrée en liste d.attente/);
  });

  it("renders one row per entry: patient, phone, FR service name, DD/MM/YYYY dates, source badge", () => {
    render(
      <WaitlistList
        entries={[
          makeEntry(),
          makeEntry({
            id: "w2",
            source: "PATIENT",
            preferredDates: ["2026-10-06T23:00:00.000Z"],
            patient: {
              id: "p2",
              firstName: "Amine",
              lastName: "Haddad",
              phoneE164: "+213550654321",
              active: true,
              anonymizedAt: null,
            },
            service: {
              id: "s2",
              name: { fr: "Orthodontie", ar: null, en: null },
              slug: "orthodontie",
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Alaoui Sofia")).toBeInTheDocument();
    expect(screen.getByText("+213550123456")).toBeInTheDocument();
    expect(screen.getByText("Consultation générale")).toBeInTheDocument();
    // Clinic-local DD/MM/YYYY rendering of the watched dates.
    expect(screen.getByText("05/10/2026 · 06/10/2026")).toBeInTheDocument();
    expect(screen.getByText("07/10/2026")).toBeInTheDocument();
    // Source badges: STAFF → Guichet, PATIENT → En ligne.
    expect(screen.getByText("Guichet")).toBeInTheDocument();
    expect(screen.getByText("En ligne")).toBeInTheDocument();
    expect(screen.getByText("Haddad Amine")).toBeInTheDocument();
  });

  it("shows the notification date when notifiedAt is set", () => {
    render(
      <WaitlistList
        entries={[makeEntry({ notifiedAt: "2026-09-02T08:00:00.000Z" })]}
      />,
    );
    expect(screen.getByText(/Notifié le/)).toBeInTheDocument();
  });

  it("requires an explicit inline confirmation before DELETE, then notifies the parent", async () => {
    const onDeleted = vi.fn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { id: "w1", active: false }),
    );
    render(<WaitlistList entries={[makeEntry()]} onDeleted={onDeleted} />);

    // Step 1 — arming the confirm does NOT call DELETE yet.
    fireEvent.click(screen.getByRole("button", { name: /Supprimer/ }));
    expect(fetch).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Supprimer cette entrée de la liste d.attente/),
    ).toBeInTheDocument();

    // Step 2 — the confirm button fires DELETE, then the parent reloads.
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/waitlist/w1");
    expect(init.method).toBe("DELETE");
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("w1"));
  });

  it("cancels the delete on Annuler without firing DELETE", () => {
    const onDeleted = vi.fn();
    render(<WaitlistList entries={[makeEntry()]} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole("button", { name: /Supprimer/ }));
    expect(
      screen.getByText(/Supprimer cette entrée de la liste d.attente/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));

    expect(
      screen.queryByText(/Supprimer cette entrée de la liste d.attente/),
    ).toBeNull();
    expect(screen.getByText("Alaoui Sofia")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("surfaces the server's French error message inline (role=alert) on a failed DELETE", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(404, { error: { code: "NOT_FOUND", message: "Entrée introuvable." } }),
    );
    render(<WaitlistList entries={[makeEntry()]} onDeleted={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Supprimer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));

    // findByText, not findByRole("alert") — the confirm banner itself is an
    // alert, so the role query resolves too early (same as PatientDocuments).
    expect(await screen.findByText("Entrée introuvable.")).toBeInTheDocument();
    // The row survives — nothing was deleted.
    expect(screen.getByText("Alaoui Sofia")).toBeInTheDocument();
  });
});
