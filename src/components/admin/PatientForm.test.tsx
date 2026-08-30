// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import PatientForm, { type FormValues, type PatientFormSuccess } from "./PatientForm";

// Task 13 étape 8 (ortho-tester, rattrapage étape 7) — component-level proof
// for the file the task-13 dispatch flags as the #1 regression risk:
// `PatientForm.tsx` was created in step 7 (create-only) and then extended
// ADDITIVELY in step 8 with `patientId`/`initialValues`/`readOnly`/
// `submitLabel` to serve the edit screen too. This file is the first React
// component test in the repo (no jsdom/@testing-library/react before this
// task — see this step's Journal entry for the minimal tooling added).
//
// Every `fetch` here is stubbed; these tests prove the component's own
// request-building/state logic, not the routes themselves (those already
// have route-level integration coverage in tests/integration/patient-*.ts).

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const DUPLICATE_CANDIDATE = {
  id: "other-patient-id",
  firstName: "Amine",
  lastName: "Benali",
  phone: "+213550000001",
  active: true,
  matchedOn: ["NAME"] as const,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function fillCreateFields() {
  fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Benali" } });
  fireEvent.change(screen.getByLabelText("Prénom"), { target: { value: "Sara" } });
  fireEvent.change(screen.getByLabelText("Téléphone"), { target: { value: "0550000000" } });
}

describe("PatientForm — create mode (step 7 path, must not regress)", () => {
  it("POSTs to /api/admin/patients with both acknowledgement flags false, and calls onSuccess on 200", async () => {
    const onSuccess = vi.fn();
    const created: PatientFormSuccess = {
      id: "new-id",
      firstName: "Sara",
      lastName: "Benali",
      phone: "0550000000",
      active: true,
      anonymizedAt: null,
      createdAt: new Date().toISOString(),
    };
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(200, created));

    render(<PatientForm onSuccess={onSuccess} />);
    fillCreateFields();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le patient" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(created));

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/patients");
    expect(init.method).toBe("POST");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.duplicateAcknowledged).toBe(false);
    expect(sentBody.phoneSharingAcknowledged).toBe(false);
    expect(sentBody.lastName).toBe("Benali");
  });

  it("on 409 DUPLICATE_CANDIDATES shows an inline role=alert banner (never a modal) and keeps the form fully editable", async () => {
    const onSuccess = vi.fn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(409, {
        error: { code: "DUPLICATE_CANDIDATES", message: "Un patient du même nom existe déjà." },
        duplicates: [DUPLICATE_CANDIDATE],
      }),
    );

    render(<PatientForm onSuccess={onSuccess} />);
    fillCreateFields();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le patient" }));

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Un patient du même nom existe déjà.");
    expect(banner).toHaveTextContent("Benali");

    // No modal / dialog anywhere, and the underlying fields are still
    // editable — the explicit, non-negotiable acceptance criterion for this
    // banner (tasks/todo.md, task-13.md étape 7 point 4).
    expect(document.querySelector("dialog")).toBeNull();
    const lastNameInput = screen.getByLabelText("Nom") as HTMLInputElement;
    expect(lastNameInput).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Enregistrer le patient" })).not.toBeDisabled();

    // Editing the name after the banner appeared must reset the
    // acknowledgement flags and clear the banner (PatientForm.tsx
    // `handleDuplicateFieldChange` — a stale ack must never survive an
    // edited identity field).
    fireEvent.change(lastNameInput, { target: { value: "Benali-Edited" } });
    expect(lastNameInput.value).toBe("Benali-Edited");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("acknowledging the banner re-submits with duplicateAcknowledged:true and completes the create", async () => {
    const onSuccess = vi.fn();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        fetchOnce(409, {
          error: { code: "DUPLICATE_CANDIDATES", message: "Un patient du même nom existe déjà." },
          duplicates: [DUPLICATE_CANDIDATE],
        }),
      )
      .mockResolvedValueOnce(fetchOnce(200, { id: "new-id-2" }));

    render(<PatientForm onSuccess={onSuccess} />);
    fillCreateFields();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le patient" }));
    await screen.findByRole("alert");

    fireEvent.click(
      screen.getByRole("button", { name: "C'est une personne différente — enregistrer quand même" }),
    );

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: "new-id-2" }));
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body as string,
    );
    expect(secondCallBody.duplicateAcknowledged).toBe(true);
    expect(secondCallBody.phoneSharingAcknowledged).toBe(false);
    // The banner clears once the save actually succeeds.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("PatientForm — edit mode (step 8 additive props)", () => {
  const initialValues: FormValues = {
    firstName: "Sara",
    lastName: "Benali",
    phone: "0550000000",
    email: "",
    birthDate: "",
    notes: "",
    messagingOptOut: false,
    whatsappOptIn: false,
    preferredLocale: "",
  };

  it("PATCHes /api/admin/patients/<id> and sends ONLY the field that actually changed", async () => {
    const onSuccess = vi.fn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(200, { id: "patient-1" }));

    render(
      <PatientForm
        onSuccess={onSuccess}
        patientId="patient-1"
        initialValues={initialValues}
        submitLabel="Enregistrer les modifications"
      />,
    );

    fireEvent.change(screen.getByLabelText("Notes (facultatives)"), {
      target: { value: "Allergie à la pénicilline." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/patients/patient-1");
    expect(init.method).toBe("PATCH");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual({
      notes: "Allergie à la pénicilline.",
      duplicateAcknowledged: false,
      phoneSharingAcknowledged: false,
    });
    // Explicitly NOT resent — proves buildEditPatch only sends the diff.
    expect(sentBody.firstName).toBeUndefined();
    expect(sentBody.lastName).toBeUndefined();
    expect(sentBody.phone).toBeUndefined();
  });

  it("readOnly disables every field and renders no submit button, without touching create mode's defaults", () => {
    render(
      <PatientForm
        onSuccess={vi.fn()}
        patientId="patient-1"
        initialValues={initialValues}
        readOnly
      />,
    );
    expect(screen.getByLabelText("Nom")).toBeDisabled();
    expect(screen.getByLabelText("Téléphone")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Enregistrer/ })).toBeNull();
  });

  it("create mode (no patientId/readOnly given) is unaffected by the new props — still POSTs, still fully editable", () => {
    // This is the direct non-regression check for task-13's flagged risk:
    // PatientList.tsx renders <PatientForm onSuccess=... onCancel=... />
    // with none of the step-8 props, so their defaults must leave the
    // step-7 behavior identical.
    render(<PatientForm onSuccess={vi.fn()} />);
    expect(screen.getByLabelText("Nom")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Enregistrer le patient" })).toBeInTheDocument();
  });
});
