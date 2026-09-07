// @vitest-environment jsdom
//
// Conversion Slice B tests: results slider + comfort section render real
// photos, real copy and booking CTAs in FR.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import fr from "../../../../messages/fr.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children?: ReactNode; [key: string]: unknown }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
  getPathname: () => "/",
}));

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

import SmileResults from "./SmileResults";
import ComfortSection from "./ComfortSection";

function renderWithFr(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("SmileResults", () => {
  it("renders slider with real photos, caption and CTAs", () => {
    const { container, unmount } = renderWithFr(<SmileResults />);
    expect(screen.getByRole("heading", { level: 2, name: "Un sourire qui change tout" })).toBeTruthy();
    expect(screen.getByAltText("Dents avant blanchiment")).toBeTruthy();
    expect(screen.getByAltText("Dents après blanchiment")).toBeTruthy();
    expect(screen.getByRole("slider")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Prendre rendez-vous" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voir plus de résultats" })).toBeTruthy();
    expect(container.querySelector('img[src*="smile-before"]')).toBeTruthy();
    unmount();
  });
});

describe("ComfortSection", () => {
  it("renders fear-killing copy, reassurances and treatment photo", () => {
    const { container, unmount } = renderWithFr(<ComfortSection />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Peur du dentiste ? C'est normal." }),
    ).toBeTruthy();
    expect(screen.getByText("Tout est expliqué avant chaque soin")).toBeTruthy();
    expect(screen.getByAltText("La Dre Moussaoui soignant une patiente en douceur")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Prendre rendez-vous" })).toBeTruthy();
    expect(container.querySelector('img[src*="dr-treatment"]')).toBeTruthy();
    unmount();
  });
});
