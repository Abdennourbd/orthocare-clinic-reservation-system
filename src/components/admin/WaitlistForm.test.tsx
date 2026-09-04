// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import WaitlistForm from "./WaitlistForm";

// Task 17.3 — WaitlistForm component tests, mirroring ManualSmsForm.test.tsx
// conventions (fetchOnce helper, vi.stubGlobal("fetch", …), jsdom). The
// patient picker is SUBMIT-ONLY (same audited, rate-limited
// GET /api/admin/patients?q=… ruling as ManualSmsForm), so the tests drive
// the "Rechercher" button instead of a debounce. Services arrive as props
// from the dashboard container (fetched once from /api/services?locale=fr),
// keeping this form's network surface to patient search + POST create.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const PATIENT = {
  id: "p1",
  firstName: "Sofia",
  lastName: "Alaoui",
  phone: "+213550123456",
  active: true,
  anonymizedAt: null,
};

const SERVICES = [
  { id: "s1", name: "Consultation générale" },
  { id: "s2", name: "Orthodontie" },
];

function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400_000);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function pickFirstPatient() {
  fireEvent.change(screen.getByLabelText("Rechercher (nom ou téléphone)"), {
    target: { value: "Alaoui" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(await screen.findByRole("button", { name: "Sofia Alaoui +213550123456" }));
}

async function fillValidForm() {
  await pickFirstPatient();
  fireEvent.change(screen.getByLabelText("Service"), { target: { value: "s1" } });
  fireEvent.change(screen.getByLabelText("Date à surveiller"), {
    target: { value: futureDate(5) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ajouter la date" }));
}

describe("WaitlistForm", () => {
  it("searches patients submit-only and posts { patientId, serviceId, preferredDates }", async () => {
    const onCreated = vi.fn();
    const target = futureDate(5);
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { patients: [PATIENT] }))
      .mockResolvedValueOnce(fetchOnce(201, { entry: { id: "w1" } }));

    render(<WaitlistForm services={SERVICES} onCreated={onCreated} />);
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Ajouter à la liste d'attente" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(url).toBe("/api/admin/waitlist");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      patientId: "p1",
      serviceId: "s1",
      preferredDates: [target],
    });

    // Success banner + full form reset (patient chip gone, dates cleared).
    expect(await screen.findByRole("status")).toHaveTextContent("ajouté à la liste d'attente");
    expect(screen.queryByText("Sofia Alaoui")).toBeNull();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("shows validation and does NOT fetch when nothing is selected", async () => {
    const onCreated = vi.fn();
    render(<WaitlistForm services={SERVICES} onCreated={onCreated} />);

    fireEvent.click(screen.getByRole("button", { name: "Ajouter à la liste d'attente" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText("Sélectionnez un patient.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("rejects a past date client-side with a French message and never POSTs it", async () => {
    const onCreated = vi.fn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { patients: [PATIENT] }),
    );
    render(<WaitlistForm services={SERVICES} onCreated={onCreated} />);
    await pickFirstPatient();
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "s1" } });

    fireEvent.change(screen.getByLabelText("Date à surveiller"), {
      target: { value: "2020-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter la date" }));

    expect(screen.getByText("Cette date est dans le passé.")).toBeInTheDocument();
    // The past date was refused — still no watched date, so no POST either.
    fireEvent.click(screen.getByRole("button", { name: "Ajouter à la liste d'attente" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Au moins une date est requise.")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("disables the submit button while pending", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { patients: [PATIENT] }))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<WaitlistForm services={SERVICES} onCreated={vi.fn()} />);
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Ajouter à la liste d'attente" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Ajout…" })).toBeDisabled();
  });

  it("shows the server's French error message inline (role=alert) on a 400", async () => {
    const onCreated = vi.fn();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { patients: [PATIENT] }))
      .mockResolvedValueOnce(
        fetchOnce(400, {
          error: { code: "INVALID_WATCH_DATES", message: "Une des dates est dans le passé." },
        }),
      );
    render(<WaitlistForm services={SERVICES} onCreated={onCreated} />);
    await fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Ajouter à la liste d'attente" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Une des dates est dans le passé.");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
