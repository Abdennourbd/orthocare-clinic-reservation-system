// @vitest-environment jsdom
//
// Component test for the proof bar (home-ui Task 2): locks in verified facts
// only — no invented stats — across FR/AR/EN.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import fr from "../../../../messages/fr.json";
import en from "../../../../messages/en.json";
import ar from "../../../../messages/ar.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
  getPathname: () => "/",
}));

import TrustStrip from "./TrustStrip";

function renderBar(locale: string, messages: typeof fr) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TrustStrip />
    </NextIntlClientProvider>,
  );
}

describe("TrustStrip (proof bar)", () => {
  it("shows verified facts only, exactly 3 items (fr)", () => {
    const { container, unmount } = renderBar("fr", fr);

    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(screen.queryByText("5000+")).toBeNull();
    expect(screen.queryByText("98%")).toBeNull();
    expect(screen.queryByText("4,9/5 sur Google")).toBeNull();
    expect(screen.getByText("4,8/5 sur Google · 37 avis")).toBeTruthy();
    expect(screen.getByText("Sam – Jeu : 10h00 – 17h00")).toBeTruthy();
    expect(screen.getByText("+213 793 03 58 93")).toBeTruthy();
    unmount();
  });

  it("renders translated labels (en + ar)", () => {
    const { unmount } = renderBar("en", en);
    expect(screen.getByText("Google reviews")).toBeTruthy();
    expect(screen.getByText("Online booking, confirmed by call")).toBeTruthy();
    unmount();

    const second = renderBar("ar", ar);
    expect(screen.getByText("تقييمات جوجل")).toBeTruthy();
    expect(screen.getByText("حجز عبر الإنترنت مع تأكيد هاتفي")).toBeTruthy();
    second.unmount();
  });
});
