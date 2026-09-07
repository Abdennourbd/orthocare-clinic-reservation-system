// @vitest-environment jsdom
//
// Component test for the gooey desktop nav: locks in locale-aware labels,
// route-driven active pill (aria-current + data-active), and the mobile
// menu toggle. framer-motion needs window.matchMedia, stubbed here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import fr from "../../../messages/fr.json";

const pathState = vi.hoisted(() => ({ pathname: "/services" }));

vi.mock("@/i18n/navigation", () => ({
  // Pass-through stub: unlike the BookingWizard stub, this one must forward
  // data-*/aria-*/style/className — the gooey active pill is asserted
  // through data-active="true" + aria-current="page" on the link itself.
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => pathState.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
  getPathname: () => "/",
}));

import Nav from "./Nav";

function stubMatchMedia() {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderNav() {
  stubMatchMedia();
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <Nav />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  pathState.pathname = "/services";
});

describe("Nav (gooey)", () => {
  it("marks the current route active and renders all labels", () => {
    const { container, unmount } = renderNav();

    // Desktop gooey bar present with all 7 labels.
    const bar = container.querySelector('[data-slot="gooey-nav"]');
    expect(bar).toBeTruthy();
    for (const label of [
      "Accueil",
      "Nos services",
      "Avis",
      "FAQ",
      "Galerie",
      "À propos",
      "Contact",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    // Only the Services pill is active.
    const active = container.querySelectorAll(
      '[data-slot="gooey-nav-item"][data-active="true"]',
    );
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toBe("Nos services");
    expect(active[0].getAttribute("aria-current")).toBe("page");
    unmount();
  });

  it("opens and closes the mobile menu", () => {
    const { container, unmount } = renderNav();

    // The desktop gooey bar is always in the DOM (CSS-hidden on mobile),
    // so track the mobile panel by id.
    const button = screen.getByRole("button", { name: "Menu" });
    expect(container.querySelector("#mobile-nav")).toBeNull();
    fireEvent.click(button);
    expect(container.querySelector("#mobile-nav")).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(container.querySelector("#mobile-nav")).toBeNull();
    unmount();
  });
});
