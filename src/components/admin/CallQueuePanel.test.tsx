// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import CallQueuePanel, { expiryLabel } from "./CallQueuePanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("expiryLabel", () => {
  it("formats countdown in French, explicit overdue", () => {
    expect(expiryLabel(-5)).toBe("expiré — le cron va purger");
    expect(expiryLabel(30_000)).toBe("expire dans moins d'une minute");
    expect(expiryLabel(20 * 60000)).toBe("expire dans 20 min");
    expect(expiryLabel(2 * 3600_000 + 14 * 60000)).toBe("expire dans 2 h 14");
  });
});

describe("CallQueuePanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          appointments: [
            {
              id: "q1",
              createdAt: new Date().toISOString(),
              startTime: new Date().toISOString(),
              endTime: new Date().toISOString(),
              source: "ONLINE",
              patient: { id: "p1", firstName: "Sara", lastName: "Ben", phone: "0550111333" },
              service: { id: "s1", name: { fr: "Consultation" }, durationMinutes: 30 },
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              msRemaining: 3600_000,
            },
          ],
        }),
      }) as Response),
    );
  });

  it("shows top queue with countdown + call link", async () => {
    render(<CallQueuePanel />);
    expect(await screen.findByText("Ben Sara")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Appeler" })).toHaveAttribute("href", expect.stringContaining("tel:"));
    expect(screen.getByRole("status")).toHaveTextContent(/expire dans/);
    expect(screen.getByRole("link", { name: /Toute la file/ })).toBeInTheDocument();
  });

  it("shows empty state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ appointments: [] }) }) as Response),
    );
    render(<CallQueuePanel />);
    expect(await screen.findByText(/File vide/)).toBeInTheDocument();
  });
});
