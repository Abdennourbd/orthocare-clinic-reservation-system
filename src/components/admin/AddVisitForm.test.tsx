// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AddVisitForm from "./AddVisitForm";

// Task 13 étape 8 (ortho-tester) — proves the acceptance criterion "ajouter
// une visite manuelle la fait apparaître dans la timeline SANS rechargement
// complet de la page": AddVisitForm never navigates, it only calls the
// `onCreated` callback the parent (PatientDetail) uses to bump
// PatientTimeline's reload token. Also proves the service selector is
// optional and a failed /api/services lookup never blocks submission.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("location", { ...window.location, reload: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("AddVisitForm — date defaults to the CLINIC's local date, not UTC", () => {
  // Correction étape 8 (audit ortho-reviewer, MINEUR) — `todayLocalDate()`
  // used to be `new Date().toISOString().slice(0, 10)` (UTC calendar date).
  // Between 00h00 and 01h00 in Africa/Algiers (UTC+1), that is a day BEHIND
  // the clinic's actual date. `EMPTY_VALUES.date` is computed once at module
  // evaluation time, so the fake system time must be set BEFORE the module
  // is imported — hence `vi.resetModules()` + a dynamic `import()` inside
  // this test instead of the static top-of-file import the other tests use.
  it("pre-fills the visit date as the clinic's date, not UTC's, just after UTC midnight", async () => {
    vi.useFakeTimers();
    // 2026-08-30T23:30:00.000Z is 2026-08-31T00:30 in Africa/Algiers
    // (UTC+1) — 30 minutes into the clinic's next calendar day, while UTC is
    // still on the previous one. The old UTC-based code would default to
    // "2026-08-30"; the fix must default to "2026-08-31".
    vi.setSystemTime(new Date("2026-08-30T23:30:00.000Z"));
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchOnce(200, { services: [] })));

    const { default: AddVisitFormFrozen } = await import("./AddVisitForm");
    render(<AddVisitFormFrozen patientId="patient-1" onCreated={vi.fn()} />);

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-08-31");

    vi.useRealTimers();
  });
});

describe("AddVisitForm", () => {
  it("posts to /api/admin/patients/<id>/visits, calls onCreated, and never reloads the page", async () => {
    const onCreated = vi.fn();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { services: [] })) // GET /api/services
      .mockResolvedValueOnce(fetchOnce(201, { id: "visit-1" })); // POST .../visits

    render(<AddVisitForm patientId="patient-1" onCreated={onCreated} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Traitement (facultatif)"), {
      target: { value: "Nettoyage" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la visite" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(url).toBe("/api/admin/patients/patient-1/visits");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.treatment).toBe("Nettoyage");
    expect(body.serviceId).toBeUndefined(); // optional, left empty here

    // Explicit acceptance criterion: no full page reload.
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it("a failed /api/services lookup leaves the selector empty but never blocks the form", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(fetchOnce(201, { id: "visit-2" }));

    const onCreated = vi.fn();
    render(<AddVisitForm patientId="patient-1" onCreated={onCreated} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    expect(screen.getByLabelText("Service (facultatif)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la visite" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("shows the server's error message inline (role=alert) and does not call onCreated on failure", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { services: [] }))
      .mockResolvedValueOnce(
        fetchOnce(400, { error: { code: "VALIDATION_ERROR", message: "Date de visite invalide." } }),
      );
    const onCreated = vi.fn();
    render(<AddVisitForm patientId="patient-1" onCreated={onCreated} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Ajouter la visite" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Date de visite invalide.");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
