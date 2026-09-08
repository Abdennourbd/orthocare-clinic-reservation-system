// @vitest-environment jsdom
//
// Header test: locks the condensing-header contract — brand name present
// with the scroll-collapse class, bar with the compact class. The collapse
// itself is pure CSS (animation-timeline), so there is nothing to simulate:
// these classes ARE the feature.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import fr from "../../../messages/fr.json";

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

import Header from "./Header";

describe("Header (condensing)", () => {
  it("renders brand lockup with collapse classes", () => {
    const { container, unmount } = render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <Header />
      </NextIntlClientProvider>,
    );

    const name = screen.getByText("Ortho'Care Clinic");
    expect(name.classList.contains("brand-collapse")).toBe(true);
    const bar = container.querySelector(".site-header-shadow.site-header-compact");
    expect(bar).toBeTruthy();
    expect(screen.getByRole("link", { name: "Prendre rendez-vous" })).toBeTruthy();
    unmount();
  });
});
