// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import BroadcastForm from "./BroadcastForm";
import SmsCenter from "./SmsCenter";

// Task 16 — BroadcastForm component tests, mirroring AddVisitForm.test.tsx
// conventions. Covers: the preview → confirm two-step flow, the idempotency
// key being minted at preview time and carried verbatim into the send,
// key regeneration after an input change, the disabled-submit guard while
// pending, and the SmsCenter role contract (Diffusion tab ADMIN-only).

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const PREVIEW = {
  date: "2026-09-02",
  delayMinutes: 15,
  recipientCount: 2,
  recipients: [
    {
      appointmentId: "appt-1",
      patientId: "p1",
      firstName: "Sofia",
      lastName: "Alaoui",
      startTime: "2026-09-02T08:00:00.000Z",
      phone: "+213550123456",
    },
    {
      appointmentId: "appt-2",
      patientId: "p2",
      firstName: "Amine",
      lastName: "Haddad",
      startTime: "2026-09-02T08:30:00.000Z",
      phone: "+213550654321",
    },
  ],
  excluded: [
    { appointmentId: "appt-3", reason: "CANCELLED" },
    { appointmentId: "appt-4", reason: "OPTED_OUT" },
  ],
  sampleBody: "Bonjour, le cabinet connaît un retard d'environ 15 minutes aujourd'hui.",
};

const SEND_RESULT = {
  batchId: "batch-1",
  sentCount: 3,
  suppressedCount: 1,
  failedCount: 0,
  alreadySent: false,
  recipientCount: 4,
};

function mockPreviewThenSend(sendResponse: unknown, sendStatus = 200) {
  (fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce(fetchOnce(200, PREVIEW))
    .mockResolvedValueOnce(fetchOnce(sendStatus, sendResponse));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("BroadcastForm", () => {
  it("posts { date, delayMinutes } to the preview, renders counts + French exclusion labels, and hides Envoyer until the preview succeeded", async () => {
    const onNotify = vi.fn();
    const onSent = vi.fn();
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(200, PREVIEW));
    render(<BroadcastForm onNotify={onNotify} onSent={onSent} />);

    // The preview IS the confirmation: no send button before it succeeded.
    expect(screen.queryByRole("button", { name: "Envoyer la diffusion" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Aperçu" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/admin/sms/broadcast/preview");
    expect(init.method).toBe("POST");
    const dateValue = (screen.getByLabelText(/Date visée/) as HTMLInputElement).value;
    expect(JSON.parse(init.body as string)).toEqual({ date: dateValue, delayMinutes: 15 });

    expect(await screen.findByText("2 destinataire(s)")).toBeInTheDocument();
    expect(screen.getByText("annulé")).toBeInTheDocument();
    expect(screen.getByText("opposé aux messages")).toBeInTheDocument();
    expect(screen.getByText(/Exemple de message/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(PREVIEW.sampleBody))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Envoyer la diffusion" })).toBeInTheDocument();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it("sends with the SAME idempotencyKey minted at preview and reports the batch counts", async () => {
    const onNotify = vi.fn();
    const onSent = vi.fn();
    mockPreviewThenSend(SEND_RESULT);
    render(<BroadcastForm onNotify={onNotify} onSent={onSent} />);

    fireEvent.click(screen.getByRole("button", { name: "Aperçu" }));
    await screen.findByText("2 destinataire(s)");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la diffusion" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(url).toBe("/api/admin/sms/broadcast");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    // The key is the client-side double-click guard layer 1: a stable,
    // non-empty UUID minted once at preview time (server dedupes on it).
    expect(body.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(body.date).toBe(PREVIEW.date);
    expect(body.delayMinutes).toBe(15);

    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith({
        kind: "success",
        message: "3 envoyé(s), 1 ignoré(s), 0 échec(s) — lot batch-1",
      }),
    );
    // Reset + bump reload so the (hidden) history refetches.
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("2 destinataire(s)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Envoyer la diffusion" })).toBeNull();
  });

  it("disables the send button while pending (double-click protection layer 2)", async () => {
    const onNotify = vi.fn();
    // Preview resolves; the send NEVER does — controlled pending state.
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, PREVIEW))
      .mockImplementationOnce(() => new Promise(() => {}));
    render(<BroadcastForm onNotify={onNotify} onSent={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Aperçu" }));
    await screen.findByText("2 destinataire(s)");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la diffusion" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    // The label switches to "Envoi…" while the request is in flight.
    expect(screen.getByRole("button", { name: "Envoi…" })).toBeDisabled();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it("clears the preview and regenerates the idempotency key when delayMinutes changes", async () => {
    const onNotify = vi.fn();
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, PREVIEW))
      .mockResolvedValueOnce(fetchOnce(200, SEND_RESULT))
      .mockResolvedValueOnce(fetchOnce(200, { ...PREVIEW, delayMinutes: 30 }))
      .mockResolvedValueOnce(fetchOnce(200, SEND_RESULT));
    render(<BroadcastForm onNotify={onNotify} onSent={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Aperçu" }));
    await screen.findByText("2 destinataire(s)");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la diffusion" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const firstKey = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body as string,
    ).idempotencyKey as string;

    // Changing the delay invalidates the stale preview AND its key…
    fireEvent.change(screen.getByLabelText(/Retard \(minutes\)/), { target: { value: "30" } });
    expect(screen.queryByText("2 destinataire(s)")).toBeNull();
    expect(screen.queryByRole("button", { name: "Envoyer la diffusion" })).toBeNull();

    // …so the next confirmed broadcast carries a NEW key.
    fireEvent.click(screen.getByRole("button", { name: "Aperçu" }));
    await screen.findByText("2 destinataire(s)");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la diffusion" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    const secondBody = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[3][1].body as string,
    );
    expect(secondBody.delayMinutes).toBe(30);
    expect(secondBody.idempotencyKey).toBeTruthy();
    expect(secondBody.idempotencyKey).not.toBe(firstKey);
    expect(onNotify).toHaveBeenCalledTimes(2);
  });
});

describe("SmsCenter role contract", () => {
  function mockHistoryFetches() {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.startsWith("/api/admin/sms/batches")) {
        return Promise.resolve(fetchOnce(200, { batches: [] }));
      }
      return Promise.resolve(fetchOnce(200, { messages: [], nextCursor: null }));
    });
  }

  it("hides the Diffusion tab for a RECEPTIONIST while keeping envoi + historique", () => {
    mockHistoryFetches();
    render(<SmsCenter role="RECEPTIONIST" />);
    expect(screen.queryByRole("button", { name: "Diffusion" })).toBeNull();
    expect(screen.getByRole("button", { name: "Envoi manuel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Historique" })).toBeInTheDocument();
  });

  it("shows the Diffusion tab for an ADMIN", () => {
    mockHistoryFetches();
    render(<SmsCenter role="ADMIN" />);
    expect(screen.getByRole("button", { name: "Diffusion" })).toBeInTheDocument();
  });
});
