// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import WaitlistDashboard from "./WaitlistDashboard";

// BUG-1 regression: delete success banner must survive parent reload.
// WaitlistList used to own successMessage, but parent reload() set
// loading=true → skeleton unmounted the list → message wiped.

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "w1",
    preferredDates: ["2026-10-04T23:00:00.000Z"],
    source: "STAFF",
    active: true,
    notifiedAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    patient: {
      id: "p1",
      firstName: "Sofia",
      lastName: "Alaoui",
      phoneE164: "+213550123456",
      active: true,
      anonymizedAt: null,
    },
    service: {
      id: "s1",
      name: { fr: "Consultation générale", ar: null, en: null },
      slug: "consultation-generale",
    },
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
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

describe("WaitlistDashboard delete notice (BUG-1)", () => {
  it("keeps the delete success banner visible after reload", async () => {
    const entry = makeEntry();
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("/api/services")) {
        return Promise.resolve(jsonResponse(200, { services: [] }));
      }
      if (u.startsWith("/api/admin/waitlist/") && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse(200, { id: "w1", active: false }));
      }
      if (u.startsWith("/api/admin/waitlist")) {
        const calls = vi.mocked(fetch).mock.calls as unknown as Array<
          [string, RequestInit | undefined]
        >;
        const deletes = calls.filter(
          ([cu, ci]) => String(cu).startsWith("/api/admin/waitlist/") && ci?.method === "DELETE",
        );
        // After DELETE, reload returns an empty list (row gone).
        if (deletes.length > 0) {
          return Promise.resolve(jsonResponse(200, { entries: [] }));
        }
        return Promise.resolve(jsonResponse(200, { entries: [entry] }));
      }
      return Promise.resolve(jsonResponse(404, {}));
    });

    render(<WaitlistDashboard />);

    // Initial row renders.
    expect(await screen.findByText("Alaoui Sofia")).toBeInTheDocument();

    // Two-step delete.
    fireEvent.click(screen.getByRole("button", { name: /Supprimer l'entrée de/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));

    // Banner appears and survives the parent reload (row gone → empty state,
    // but banner still present).
    const banner = await screen.findByText("Entrée supprimée de la liste d'attente.");
    expect(banner).toHaveAttribute("role", "status");
    await waitFor(() => expect(screen.queryByText("Alaoui Sofia")).toBeNull());
    expect(screen.getByText("Entrée supprimée de la liste d'attente.")).toBeInTheDocument();
  });
});
