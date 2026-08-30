// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import PatientList from "./PatientList";

// Task 13 étape 8 (ortho-tester, rattrapage étape 7) — task-13.md's dispatch
// explicitly names this the #1 regression risk of this wave: PatientForm.tsx
// (rendered here with NO patientId/initialValues/readOnly — the create-mode
// defaults) was extended additively in step 8 to also serve the edit screen.
// This file proves the two step-7 acceptance criteria end to end through
// PatientList itself, not just through PatientForm in isolation: creating a
// patient works, and an inline (never-modal) duplicate warning with
// "enregistrer quand même" still creates the second patient.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const EMPTY_LIST = { patients: [], total: 0 };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("PatientList — create flow (step 7, must not regress after step 8's PatientForm changes)", () => {
  it("creating a patient from the list reloads the list and shows a success banner", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, EMPTY_LIST)) // initial GET list
      .mockResolvedValueOnce(
        fetchOnce(200, { id: "new-1", firstName: "Sara", lastName: "Benali" }),
      ) // POST create
      .mockResolvedValueOnce(
        fetchOnce(200, {
          patients: [
            { id: "new-1", firstName: "Sara", lastName: "Benali", phone: "0550000000", active: true, anonymizedAt: null, createdAt: new Date().toISOString() },
          ],
          total: 1,
        }),
      ); // reload GET list

    render(<PatientList />);
    await screen.findByText("Aucun patient trouvé.");

    fireEvent.click(screen.getByRole("button", { name: "Nouveau patient", expanded: false }));
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Benali" } });
    fireEvent.change(screen.getByLabelText("Prénom"), { target: { value: "Sara" } });
    fireEvent.change(screen.getByLabelText("Téléphone"), { target: { value: "0550000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le patient" }));

    const banner = await screen.findByText(/créé/);
    expect(banner).toBeInTheDocument();
    // The list reloaded (3rd fetch call) and now shows the new patient.
    expect(await screen.findByText("Benali")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("/api/admin/patients");
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].method).toBe("POST");
  });

  it("a 409 duplicate on create shows the inline banner (no modal) inside the list screen, and 'enregistrer quand même' still creates the patient", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, EMPTY_LIST)) // initial GET list
      .mockResolvedValueOnce(
        fetchOnce(409, {
          error: { code: "DUPLICATE_CANDIDATES", message: "Un patient du même nom existe déjà." },
          duplicates: [
            {
              id: "existing-1",
              firstName: "Amine",
              lastName: "Benali",
              phone: "+213550000001",
              active: true,
              matchedOn: ["NAME"],
            },
          ],
        }),
      ) // POST create #1 -> duplicate
      .mockResolvedValueOnce(fetchOnce(200, { id: "new-2", firstName: "Sara", lastName: "Benali" })) // POST create #2 -> ack, succeeds
      .mockResolvedValueOnce(fetchOnce(200, EMPTY_LIST)); // reload GET list

    render(<PatientList />);
    await screen.findByText("Aucun patient trouvé.");

    fireEvent.click(screen.getByRole("button", { name: "Nouveau patient", expanded: false }));
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Benali" } });
    fireEvent.change(screen.getByLabelText("Prénom"), { target: { value: "Sara" } });
    fireEvent.change(screen.getByLabelText("Téléphone"), { target: { value: "0550000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le patient" }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Un patient du même nom existe déjà.");
    expect(document.querySelector("dialog")).toBeNull();

    // The page must remain usable at the keyboard — the search form beneath
    // is still present and untouched while the banner is shown.
    expect(screen.getByLabelText("Rechercher (nom ou téléphone)")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "C'est une personne différente — enregistrer quand même" }),
    );

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(await screen.findByText(/créé/)).toBeInTheDocument();
  });
});
