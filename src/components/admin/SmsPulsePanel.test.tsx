// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SmsPulsePanel, { formatPulseTime } from "./SmsPulsePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("formatPulseTime", () => {
  it("formats in clinic time regardless of browser tz", () => {
    // 10:00 Algiers = 09:00Z. TZ env is UTC in tests; the helper must still
    // render the Algiers wall time, never the raw UTC time.
    expect(formatPulseTime("2026-09-01T09:05:00.000Z")).toBe("01/09 10:05");
  });
});

describe("SmsPulsePanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/api/admin/sms?")) {
          return {
            ok: true,
            json: async () => ({
              messages: [
                {
                  id: "m1",
                  to: "+213550111222",
                  body: "Rappel demain 10h",
                  type: "REMINDER",
                  provider: "mock",
                  status: "SENT",
                  sentAt: "2026-09-01T09:05:00.000Z",
                  createdAt: "2026-09-01T09:05:00.000Z",
                  patient: { id: "p1", firstName: "Lina", lastName: "Haddad" },
                },
              ],
            }),
          } as Response;
        }
        return { ok: true, json: async () => ({ sent: true }) } as Response;
      }),
    );
  });

  it("lists latest messages with clinic-local time + quick composer", async () => {
    render(<SmsPulsePanel patients={[{ id: "p1", firstName: "Lina", lastName: "Haddad" }]} />);
    expect(await screen.findByText("Haddad Lina")).toBeInTheDocument();
    expect(screen.getByText("01/09 10:05")).toBeInTheDocument();
    expect(screen.getByText("Rappel")).toBeInTheDocument();
    expect(screen.getByText("Envoyé")).toBeInTheDocument();
    expect(screen.getByLabelText("Patient de la semaine")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Patient de la semaine"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le SMS" }));
    expect(await screen.findByText(/SMS envoyé à/)).toBeInTheDocument();
  });

  it("validates empty composer without network call", async () => {
    render(<SmsPulsePanel patients={[{ id: "p1", firstName: "Lina", lastName: "Haddad" }]} />);
    await screen.findByText("Haddad Lina");
    fireEvent.click(screen.getByRole("button", { name: "Envoyer le SMS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Choisissez un patient/);
  });
});
