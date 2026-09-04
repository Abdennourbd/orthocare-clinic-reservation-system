// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import ManualBookingForm from "./ManualBookingForm";

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const PATIENT = {
  id: "p1",
  firstName: "Sara",
  lastName: "Benali",
  phone: "0550111222",
  active: true,
  anonymizedAt: null,
};

const SERVICES = [{ id: "s1", name: "Consultation", durationMinutes: 30 }];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function pickFirstPatient() {
  fireEvent.change(screen.getByLabelText("Rechercher (nom ou téléphone)"), {
    target: { value: "Benali" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  fireEvent.click(
    await screen.findByRole("button", { name: "Sara Benali 0550111222" }),
  );
}

describe("ManualBookingForm", () => {
  it("surfaces a SLOT_TAKEN 409 inline without calling onSuccess", async () => {
    const onSuccess = vi.fn();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { services: SERVICES }))
      .mockResolvedValueOnce(fetchOnce(200, { patients: [PATIENT] }))
      .mockResolvedValueOnce(
        fetchOnce(409, { error: { code: "SLOT_TAKEN", message: "Créneau pris." } }),
      );
    render(<ManualBookingForm onSuccess={onSuccess} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await pickFirstPatient();
    fireEvent.change(screen.getByLabelText("Service"), {
      target: { value: "s1" },
    });
    fireEvent.change(screen.getByLabelText("Date (heure du cabinet)"), {
      target: { value: "2026-09-02" },
    });
    fireEvent.change(screen.getByLabelText("Heure"), {
      target: { value: "10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer le rendez-vous" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Créneau pris.");
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("does nothing without a picked patient (no fetch, no success)", async () => {
    const onSuccess = vi.fn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { services: SERVICES }),
    );
    render(<ManualBookingForm onSuccess={onSuccess} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Créer le rendez-vous" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
