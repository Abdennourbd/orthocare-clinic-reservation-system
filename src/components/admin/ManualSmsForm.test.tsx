// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import ManualSmsForm from "./ManualSmsForm";

// Task 16 — ManualSmsForm component tests, mirroring AddVisitForm.test.tsx
// conventions (fetchOnce helper, vi.stubGlobal("fetch", …), jsdom). The
// success outcome is reported through the `onNotify` callback the shell
// (SmsCenter) renders as the top banner, so the assertions check what the
// shell will actually display.

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

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

async function pickFirstPatient() {
  fireEvent.change(screen.getByLabelText("Rechercher un patient (nom ou téléphone)"), {
    target: { value: "Alaoui" },
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  fireEvent.click(await screen.findByRole("button", { name: "Sofia Alaoui — +213550123456" }));
}

describe("ManualSmsForm", () => {
  it("searches patients (debounced), posts { patientId, body } and reports success with the patient name", async () => {
    const onNotify = vi.fn();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { patients: [PATIENT] }))
      .mockResolvedValueOnce(fetchOnce(200, { sent: true, messageId: "m1", status: "SENT" }));

    render(<ManualSmsForm onNotify={onNotify} />);
    await pickFirstPatient();

    // Selected patient renders as a chip with a clear button.
    expect(screen.getByText("Sofia Alaoui")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(url).toBe("/api/admin/sms/single");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ patientId: "p1", body: "Bonjour" });

    // The banner message the shell will render carries the patient's name.
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith({
        kind: "success",
        message: "SMS envoyé à Sofia Alaoui.",
      }),
    );
    // Textarea cleared, patient kept selected for a follow-up send.
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(screen.getByText("Sofia Alaoui")).toBeInTheDocument();
  });

  it("shows validation and does NOT fetch when the message is empty", async () => {
    const onNotify = vi.fn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { patients: [PATIENT] }),
    );

    render(<ManualSmsForm onNotify={onNotify} />);
    await pickFirstPatient();

    expect(screen.getByLabelText("Message")).toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    // Only the patient search fetch happened — no POST for an empty message.
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Le message est requis.")).toBeInTheDocument();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it("shows the server's French error message inline (role=alert) on a 400", async () => {
    const onNotify = vi.fn();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, { patients: [PATIENT] }))
      .mockResolvedValueOnce(
        fetchOnce(400, {
          error: { code: "VALIDATION_ERROR", message: "Le message est limité à 480 caractères." },
        }),
      );

    render(<ManualSmsForm onNotify={onNotify} />);
    await pickFirstPatient();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Le message est limité à 480 caractères.");
    expect(onNotify).not.toHaveBeenCalled();
  });
});
