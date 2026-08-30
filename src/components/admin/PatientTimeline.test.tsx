// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import PatientTimeline from "./PatientTimeline";

// Task 13 étape 8 (ortho-tester) — the three explicitly graded timeline
// states (task-13.md étape 8, critère #2: chargement/`aria-busy`, vide,
// erreur+Réessayer). Sorting and CANCELLED-exclusion are already proven at
// the route level (tests/integration/patient-record.test.ts, "GET
// /api/admin/patients/[id]/history"); this component never re-sorts, so
// here we only need to prove it renders whatever order the route sent it,
// not re-prove the route's own ordering logic.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("PatientTimeline", () => {
  it("shows a skeleton with aria-busy=true while loading", () => {
    (fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {})); // never resolves
    render(<PatientTimeline patientId="p1" reloadToken={0} />);
    expect(screen.getByText("Historique").closest("div")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the exact empty-state sentence when there is no history", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(200, { items: [] }));
    render(<PatientTimeline patientId="p1" reloadToken={0} />);
    expect(
      await screen.findByText(
        "Aucun rendez-vous terminé ni visite enregistrée pour ce patient.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an error message with a working Réessayer button on a failed fetch", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(500, { error: { code: "INTERNAL", message: "boom" } }))
      .mockResolvedValueOnce(fetchOnce(200, { items: [] }));

    render(<PatientTimeline patientId="p1" reloadToken={0} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Impossible de charger l’historique de ce patient.");

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText(
        "Aucun rendez-vous terminé ni visite enregistrée pour ce patient.",
      ),
    ).toBeInTheDocument();
  });

  it("renders APPOINTMENT and VISIT items, most-recent-first as delivered by the route, distinguishing the two kinds", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, {
        items: [
          {
            kind: "APPOINTMENT",
            id: "a1",
            date: "2026-08-20T09:00:00.000Z",
            serviceName: "Détartrage",
            type: null,
            notes: "RAS",
            treatment: null,
            status: "COMPLETED",
          },
          {
            kind: "VISIT",
            id: "v1",
            date: "2026-08-10T09:00:00.000Z",
            serviceName: null,
            type: "CONTROLE",
            notes: null,
            treatment: "Nettoyage",
            status: null,
          },
        ],
      }),
    );

    render(<PatientTimeline patientId="p1" reloadToken={0} />);
    // The 3-row loading skeleton is also made of <li>s, so wait for the
    // FINAL count rather than the first non-empty `findAllByRole` result.
    await screen.findByText("Détartrage");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // Order follows exactly what the route sent — component does not re-sort.
    expect(items[0]).toHaveTextContent("Rendez-vous");
    expect(items[0]).toHaveTextContent("Détartrage");
    expect(items[1]).toHaveTextContent("Visite");
    expect(items[1]).toHaveTextContent("Contrôle");
    expect(items[1]).toHaveTextContent("Nettoyage");
    // A CANCELLED item would never be sent by the route (proven at route
    // level); nothing in this list carries that status.
    expect(screen.queryByText("CANCELLED")).toBeNull();
  });

  it("shows a dedicated rate-limit message on a 429, distinct from the generic error, with no Réessayer button", async () => {
    // Correction étape 8 (audit ortho-security, point 4) — before this fix,
    // PatientTimeline treated a 429 exactly like a 500: same "Impossible de
    // charger…" message AND a Réessayer button that would spend yet another
    // token of the shared `patients-read` rate-limit budget.
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(429, {}));

    render(<PatientTimeline patientId="p1" reloadToken={0} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Trop de consultations de dossiers en peu de temps. Réessayez dans quelques minutes.",
    );
    expect(alert).not.toHaveTextContent("Impossible de charger");
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
  });

  it("re-fetches when reloadToken changes, without a full remount signal from the caller", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { items: [] }))
      .mockResolvedValueOnce(
        fetchOnce(200, {
          items: [
            {
              kind: "VISIT",
              id: "v2",
              date: "2026-08-25T09:00:00.000Z",
              serviceName: null,
              type: "AUTRE",
              notes: null,
              treatment: null,
              status: null,
            },
          ],
        }),
      );

    const { rerender } = render(<PatientTimeline patientId="p1" reloadToken={0} />);
    await screen.findByText("Aucun rendez-vous terminé ni visite enregistrée pour ce patient.");

    rerender(<PatientTimeline patientId="p1" reloadToken={1} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByRole("listitem")).toHaveLength(1);
  });
});
