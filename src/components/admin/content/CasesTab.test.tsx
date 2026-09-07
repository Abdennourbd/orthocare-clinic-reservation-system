// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import CasesTab from "./CasesTab";

// G3 — admin case management tab: list states + create flow. fetch is stubbed
// (same pattern as PatientList.test.tsx); API behavior itself is covered by
// tests/integration/smile-cases.test.ts.

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const EMPTY = { cases: [] };

const ONE_CASE = {
  cases: [
    {
      id: "c1",
      key: "demo-1",
      title: { fr: "Encombrement sévère" },
      description: { fr: "Desc" },
      beforeImageUrl: "/images/beforewhitening.jpeg",
      afterImageUrl: "/images/afterwhitening.jpeg",
      active: true,
      sortOrder: 1,
      featured: true,
      featuredOrder: 1,
      consentConfirmed: true,
      images: [],
      _count: { images: 0 },
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("CasesTab — list states", () => {
  it("shows the empty state when no case exists", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(200, EMPTY));
    render(<CasesTab />);
    expect(await screen.findByText("Aucun cas patient pour le moment.")).toBeInTheDocument();
  });

  it("lists cases with badges and the home-feature count", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fetchOnce(200, ONE_CASE));
    render(<CasesTab />);
    expect(await screen.findByText("Encombrement sévère")).toBeInTheDocument();
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.getByText("Accueil")).toBeInTheDocument();
    expect(screen.getByText("1/4 à l'accueil")).toBeInTheDocument();
  });
});

describe("CasesTab — create flow", () => {
  it("creates a case from the form and reloads the list", async () => {
    (fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fetchOnce(200, EMPTY)) // initial GET
      .mockResolvedValueOnce(fetchOnce(201, { item: { id: "new-1", key: "cas-1" } })) // POST
      .mockResolvedValueOnce(fetchOnce(200, ONE_CASE)); // reload GET

    render(<CasesTab />);
    await screen.findByText("Aucun cas patient pour le moment.");

    fireEvent.click(screen.getByRole("button", { name: "Nouveau cas" }));
    fireEvent.change(screen.getByLabelText("Clé (identifiant unique)"), { target: { value: "cas-1" } });
    fireEvent.change(screen.getByLabelText("Titre (français)"), { target: { value: "Diastème" } });
    fireEvent.change(screen.getByLabelText("Description (français)"), { target: { value: "Fermé en 8 mois." } });
    fireEvent.change(screen.getByLabelText("URL photo avant"), { target: { value: "/images/beforewhitening.jpeg" } });
    fireEvent.change(screen.getByLabelText("URL photo après"), { target: { value: "/images/afterwhitening.jpeg" } });
    fireEvent.click(screen.getByLabelText(/Consentement écrit du patient obtenu/));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
      const post = calls.find((c) => (c[1] as RequestInit)?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse((post![1] as RequestInit).body as string);
      expect(body).toMatchObject({
        key: "cas-1",
        title: { fr: "Diastème" },
        beforeImageUrl: "/images/beforewhitening.jpeg",
        consentConfirmed: true,
      });
    });
    expect(await screen.findByText("Encombrement sévère")).toBeInTheDocument();
  });
});
