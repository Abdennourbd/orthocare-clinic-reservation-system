// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import AppointmentSearch from "./AppointmentSearch";

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const ROW = {
  id: "a1",
  startTime: new Date("2026-09-02T10:00:00Z").toISOString(),
  endTime: new Date("2026-09-02T10:30:00Z").toISOString(),
  status: "CONFIRMED",
  source: "ONLINE",
  patient: { id: "p1", firstName: "Sara", lastName: "Benali", phone: "0550111222" },
  service: { id: "s1", name: { fr: "Consultation" }, durationMinutes: 30 },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("AppointmentSearch", () => {
  it("searches by phone tail and renders rows with dialable numbers", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { appointments: [ROW] }),
    );
    render(<AppointmentSearch reloadToken={0} />);
    fireEvent.change(screen.getByLabelText("Téléphone ou nom"), {
      target: { value: "0550111222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(
      "q=0550111222",
    );
    expect(
      await screen.findByRole("link", { name: "Benali Sara" }),
    ).toBeInTheDocument();
    // Front-desk workflow: the number must be a tel: link, not plain text.
    const link = screen.getByRole("link", { name: "0550111222" });
    expect(link.getAttribute("href")).toBe("tel:0550111222");
  });

  it("shows an error state with retry on 403/429", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(403, {}));
    render(<AppointmentSearch reloadToken={0} />);
    fireEvent.change(screen.getByLabelText("Téléphone ou nom"), {
      target: { value: "Benali" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { appointments: [] }),
    );
    render(<AppointmentSearch reloadToken={0} />);
    fireEvent.change(screen.getByLabelText("Téléphone ou nom"), {
      target: { value: "0000000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));

    expect(await screen.findByText(/Aucun rendez-vous/)).toBeInTheDocument();
  });
});
