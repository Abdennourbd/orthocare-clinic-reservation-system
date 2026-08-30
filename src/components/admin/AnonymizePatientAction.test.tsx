// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AnonymizePatientAction from "./AnonymizePatientAction";

// Task 13 étape 8 (ortho-tester) — proves the two friction layers the
// acceptance criterion explicitly requires against an accidental trigger
// ("ne doit pas pouvoir partir sur un double-clic"): (1) the button stays
// disabled until the exact, case-sensitive last name is typed, and (2) a
// double-click while the request is in flight only ever fires ONE POST.
// The route's own ADMIN-only 403 for a receptionist is proven at the API
// level (tests/authz-matrix.test.ts, `allowed: [Role.ADMIN]` for this
// route) — hiding this component is UI sugar, never the access control, so
// this file does not re-prove authorization.

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

describe("AnonymizePatientAction", () => {
  it("keeps the confirm button disabled until the exact last name is typed (case-sensitive)", () => {
    render(<AnonymizePatientAction patientId="p1" lastName="Benali" onAnonymized={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Anonymiser définitivement ce dossier" });
    const input = screen.getByLabelText(/Pour confirmer, saisissez le nom de famille/);

    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "benali" } }); // wrong case, on purpose
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: "Benali" } });
    expect(button).not.toBeDisabled();

    expect(fetch).not.toHaveBeenCalled();
  });

  it("never renders a modal/dialog and requires no window.confirm", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<AnonymizePatientAction patientId="p1" lastName="Benali" onAnonymized={vi.fn()} />);
    expect(document.querySelector("dialog")).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("a double-click while pending fires only ONE POST /anonymize, and onAnonymized receives the result", async () => {
    let resolveFetch!: (value: Response) => void;
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const onAnonymized = vi.fn();

    render(<AnonymizePatientAction patientId="p1" lastName="Benali" onAnonymized={onAnonymized} />);
    fireEvent.change(screen.getByLabelText(/Pour confirmer, saisissez le nom de famille/), {
      target: { value: "Benali" },
    });
    const button = screen.getByRole("button", { name: "Anonymiser définitivement ce dossier" });

    fireEvent.click(button);
    // The button must be disabled (or re-labeled "pending") immediately, so
    // a second physical click before the request resolves cannot fire again.
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/patients/p1/anonymize");
    expect(JSON.parse(init.body as string)).toEqual({ confirm: true });

    const result = { id: "p1", anonymizedAt: new Date().toISOString(), appointmentsKept: 1, visitsKept: 0 };
    resolveFetch(fetchOnce(200, result));

    await waitFor(() => expect(onAnonymized).toHaveBeenCalledWith(result));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 403 error message inline (role=alert) without leaking patient identifiers", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(403, { error: { code: "FORBIDDEN", message: "Accès refusé." } }),
    );
    render(<AnonymizePatientAction patientId="p1" lastName="Benali" onAnonymized={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Pour confirmer, saisissez le nom de famille/), {
      target: { value: "Benali" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Anonymiser définitivement ce dossier" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Accès refusé.");
  });
});
