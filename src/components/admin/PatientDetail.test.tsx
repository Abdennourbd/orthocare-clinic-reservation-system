// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import PatientDetail from "./PatientDetail";

// Task 13 étape 8 — post-audit regression coverage (ortho-security MAJEUR-1,
// task-13.md Journal 2026-08-30). Before the fix, `AnonymizePatientAction`
// was mounted without a `key`, and the deactivation confirm banner's own
// state lived in this component with no reset at all.
//
// IMPORTANT — verified by deliberately reverting the fix (both mechanisms)
// and re-running this file before writing the assertions below:
//
//   - The deactivation-gate test genuinely isolates
//     `deactivateStateForPatientId` — reverting that render-time reset
//     makes it fail (confirmed: banner stays armed after switching to
//     patient B). That state lives directly in PatientDetail, which is
//     never unmounted by its own `loading` early-return, so nothing else
//     resets it.
//   - Switching `patientId` ALSO always drives PatientDetail's fetch effect
//     through `setLoading(true)` first (before the new patient's data
//     arrives), and that early-return swaps in a structurally different
//     JSX tree — which unmounts every child, INCLUDING
//     AnonymizePatientAction, independently of whether it carries a `key`.
//     Reverting *only* the `key` on AnonymizePatientAction, with the
//     patientId-switch scenario, therefore did NOT reproduce a failure —
//     the loading boundary already resets the child. That is an honest,
//     verified finding, not an assumption; it is why the primary
//     regression test below targets `handleUpdated` instead (édition,
//     task-13.md Journal "après une désactivation ou une édition"): that is
//     the ONE call site that updates `patient` state WITHOUT going through
//     `loading` (fix #3, avoiding the follow-up GET), so it is the one path
//     where the `key` is not redundant with the loading boundary. Reverting
//     the key DOES make that test fail (confirmed): the confirm field keeps
//     showing the pre-edit last name instead of being cleared.
//   - The homonym patientId-switch test is kept as a second, independent
//     proof of the overall observable guarantee at the acceptance-criterion
//     level (an armed confirm field must never survive a patient switch) —
//     it currently passes via the loading-boundary mechanism above, which
//     is itself production code (not test-only), so this is still a real
//     regression test for the end-to-end behaviour even though it does not,
//     on its own, isolate the `key` specifically.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function makePatient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    firstName: "Sara",
    lastName: "Benali",
    phone: "0550000001",
    email: null,
    birthDate: null,
    notes: null,
    active: true,
    anonymizedAt: null,
    consentAt: null,
    consentVersion: null,
    messagingOptOut: false,
    whatsappOptIn: false,
    preferredLocale: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function installRouter(byUrl: Record<string, () => Response>) {
  (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url in byUrl) return byUrl[url]();
    if (url.startsWith("/api/services")) return fetchOnce(200, { services: [] });
    // Task 15 step 5 — PatientDocuments now mounts inside PatientDetail and
    // fetches the (empty) documents list on load.
    if (url.endsWith("/documents")) return fetchOnce(200, { items: [], total: 0 });
    throw new Error(`Unmocked fetch in test: ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("PatientDetail — anonymize confirm gate resets across patients (regression, ortho-security MAJEUR-1)", () => {
  it("clears the erasure confirm field (not merely mismatches it) after the patient's own last name is corrected via an in-place edit — the one path that bypasses PatientDetail's loading-cycle reset", async () => {
    const patientA = makePatient({ id: "p1", lastName: "Benali", updatedAt: "2026-08-01T09:00:00.000Z" });
    const patientRenamed = makePatient({
      id: "p1",
      lastName: "Elbenali",
      updatedAt: "2026-08-30T10:00:00.000Z",
    });

    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/patients/p1" && init?.method === "PATCH") {
        return fetchOnce(200, patientRenamed);
      }
      if (url === "/api/admin/patients/p1") return fetchOnce(200, patientA);
      if (url === "/api/admin/patients/p1/history") return fetchOnce(200, { items: [] });
      if (url.endsWith("/documents")) return fetchOnce(200, { items: [], total: 0 });
      if (url.startsWith("/api/services")) return fetchOnce(200, { services: [] });
      throw new Error(`Unmocked fetch in test: ${url} ${init?.method ?? "GET"}`);
    });

    render(<PatientDetail patientId="p1" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Benali Sara" });

    // Task 15 step 5 (test-quality fix round 1) — PatientDocuments must
    // actually be mounted for an active patient; otherwise deleting the
    // `{!isAnonymized && <PatientDocuments />}` wiring would leave every
    // test green while the feature silently vanishes.
    expect(
      screen.getByRole("heading", { name: "Documents du patient" }),
    ).toBeInTheDocument();

    const confirmInput = () => screen.getByLabelText(/Pour confirmer, saisissez le nom de famille/);
    const confirmButton = () =>
      screen.getByRole("button", { name: "Anonymiser définitivement ce dossier" });

    // Arm the gate for the CURRENT (pre-edit) last name.
    fireEvent.change(confirmInput(), { target: { value: "Benali" } });
    expect(confirmButton()).not.toBeDisabled();

    // Correct a typo in the last name — same patient, same `patientId`, no
    // navigation. `handleUpdated` applies the PATCH response directly
    // (fix #3) without ever setting `loading`, so nothing else in this
    // component unmounts AnonymizePatientAction on this path.
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Elbenali" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));
    await screen.findByRole("heading", { name: "Elbenali Sara" });

    // The field must be CLEARED, not merely left stale-and-mismatched: a
    // stale "Benali" sitting in the box is exactly the half-armed state the
    // fix's own comment (task-13.md Journal) warns about ("reste à un seul
    // clic de l'effacement après ... une édition").
    expect(confirmInput()).toHaveValue("");
    expect(confirmButton()).toBeDisabled();
  });

  it("clears the erasure confirm field and re-disables the button when switching to a HOMONYM patient", async () => {
    const patientA = makePatient({ id: "p1", firstName: "Sara", lastName: "Benali" });
    // Same last name on purpose — the exact case the audit named: two
    // different patients who happen to share a family name.
    const patientB = makePatient({ id: "p2", firstName: "Amine", lastName: "Benali" });

    installRouter({
      "/api/admin/patients/p1": () => fetchOnce(200, patientA),
      "/api/admin/patients/p1/history": () => fetchOnce(200, { items: [] }),
      "/api/admin/patients/p2": () => fetchOnce(200, patientB),
      "/api/admin/patients/p2/history": () => fetchOnce(200, { items: [] }),
    });

    const { rerender } = render(<PatientDetail patientId="p1" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Benali Sara" });
    expect(
      screen.getByRole("heading", { name: "Documents du patient" }),
    ).toBeInTheDocument();

    const confirmInputFor = () =>
      screen.getByLabelText(/Pour confirmer, saisissez le nom de famille/);
    const confirmButtonFor = () =>
      screen.getByRole("button", { name: "Anonymiser définitivement ce dossier" });

    fireEvent.change(confirmInputFor(), { target: { value: "Benali" } });
    expect(confirmButtonFor()).not.toBeDisabled();

    // Client-side navigation to a homonym patient — no remount signal from
    // the router, exactly like next/link between /admin/patients/p1 and
    // /admin/patients/p2.
    rerender(<PatientDetail patientId="p2" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Benali Amine" });

    expect(confirmInputFor()).toHaveValue("");
    expect(confirmButtonFor()).toBeDisabled();
    // Patient B is also active — the documents panel must still be mounted
    // after the client-side switch.
    expect(
      screen.getByRole("heading", { name: "Documents du patient" }),
    ).toBeInTheDocument();
  });

  it("resets the deactivation confirm banner back to its initial button when switching patients", async () => {
    const patientA = makePatient({ id: "p1", lastName: "Benali", active: true });
    const patientB = makePatient({ id: "p2", lastName: "Kaddour", active: true });

    installRouter({
      "/api/admin/patients/p1": () => fetchOnce(200, patientA),
      "/api/admin/patients/p1/history": () => fetchOnce(200, { items: [] }),
      "/api/admin/patients/p2": () => fetchOnce(200, patientB),
      "/api/admin/patients/p2/history": () => fetchOnce(200, { items: [] }),
    });

    const { rerender } = render(<PatientDetail patientId="p1" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Benali Sara" });

    fireEvent.click(screen.getByRole("button", { name: "Désactiver ce dossier" }));
    expect(screen.getByRole("button", { name: "Confirmer la désactivation" })).toBeInTheDocument();

    rerender(<PatientDetail patientId="p2" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Kaddour Sara" });

    expect(screen.getByRole("button", { name: "Désactiver ce dossier" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmer la désactivation" })).toBeNull();
  });
});

describe("PatientDetail — post-audit minor fixes", () => {
  it("saving an edit issues exactly one network call (PATCH), never a follow-up GET", async () => {
    const patientA = makePatient({ id: "p1", lastName: "Benali", updatedAt: "2026-08-01T09:00:00.000Z" });
    const updated = makePatient({
      id: "p1",
      lastName: "Benali-Kadi",
      updatedAt: "2026-08-30T10:00:00.000Z",
    });

    let getRecordCalls = 0;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/admin/patients/p1" && (!init || init.method === undefined)) {
        getRecordCalls += 1;
        return fetchOnce(200, patientA);
      }
      if (url === "/api/admin/patients/p1/history") return fetchOnce(200, { items: [] });
      if (url.endsWith("/documents")) return fetchOnce(200, { items: [], total: 0 });
      if (url.startsWith("/api/services")) return fetchOnce(200, { services: [] });
      if (url === "/api/admin/patients/p1" && init?.method === "PATCH") {
        return fetchOnce(200, updated);
      }
      throw new Error(`Unmocked fetch in test: ${url} ${init?.method ?? "GET"}`);
    });

    render(<PatientDetail patientId="p1" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Benali Sara" });
    expect(getRecordCalls).toBe(1); // the one GET on initial load

    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Benali-Kadi" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les modifications" }));

    await screen.findByText("Modifications enregistrées.");
    // The PATCH response body is used directly — no second GET fired by
    // `reload()`, so `getRecordCalls` must stay exactly 1.
    expect(getRecordCalls).toBe(1);

    // The screen reflects the PATCH response body directly (new lastName),
    // and PatientForm's key={...updatedAt} remount still works off it.
    expect(await screen.findByRole("heading", { name: "Benali-Kadi Sara" })).toBeInTheDocument();
  });

  it("renders a dedicated rate-limit message without a Réessayer button on a 429", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(429, {}));

    render(<PatientDetail patientId="p1" role="ADMIN" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Trop de consultations de dossiers en peu de temps. Réessayez dans quelques minutes.",
    );
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
  });
});

describe("PatientDetail — documents panel mounting (task 15 step 5, test-quality fix round 1)", () => {
  it("mounts the documents panel for an active patient and hides it for an anonymized chart", async () => {
    const active = makePatient({ id: "p1" });
    const anonymized = makePatient({
      id: "p2",
      firstName: "Amine",
      lastName: "Kaddour",
      anonymizedAt: "2026-08-31T10:00:00.000Z",
    });

    installRouter({
      "/api/admin/patients/p1": () => fetchOnce(200, active),
      "/api/admin/patients/p1/history": () => fetchOnce(200, { items: [] }),
      "/api/admin/patients/p2": () => fetchOnce(200, anonymized),
      "/api/admin/patients/p2/history": () => fetchOnce(200, { items: [] }),
    });

    const { rerender } = render(<PatientDetail patientId="p1" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Benali Sara" });
    expect(
      screen.getByRole("heading", { name: "Documents du patient" }),
    ).toBeInTheDocument();

    // An anonymized chart must NOT mount PatientDocuments — the routes
    // close on anonymized patients anyway, but the hiding is the UX rule
    // (same as AddVisitForm) and this is what catches the wiring being
    // broken in either direction.
    rerender(<PatientDetail patientId="p2" role="ADMIN" />);
    await screen.findByRole("heading", { name: "Kaddour Amine" });
    expect(
      screen.queryByRole("heading", { name: "Documents du patient" }),
    ).toBeNull();
  });
});
