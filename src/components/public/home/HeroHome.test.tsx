// @vitest-environment jsdom
//
// Component test for the doctor-centric hero (home-ui Task 1): locks in the
// de-slopped contract — doctor name H1, book + call CTAs, translated
// portrait alt, exactly one ambient canvas (the orb), and none of the old
// slop (floating glyphs, scroll cue, hardcoded 4.9 rating).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import fr from "../../../../messages/fr.json";
import en from "../../../../messages/en.json";
import ar from "../../../../messages/ar.json";

// Same narrowly-scoped stub as BookingWizard.test.tsx: `@/i18n/navigation`
// pulls `next/navigation` at module load, which this resolver can't load.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  redirect: vi.fn(),
  getPathname: () => "/",
}));

// eslint-disable-next-line import/order -- must come after the vi.mock above
import HeroHome from "./HeroHome";

function renderHero(locale: string, messages: typeof fr) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <HeroHome />
    </NextIntlClientProvider>,
  );
}

describe("HeroHome (doctor-centric)", () => {
  it("renders name, CTAs, portrait alt and a single orb canvas (fr)", () => {
    const { container, unmount } = renderHero("fr", fr);

    expect(
      screen.getByRole("heading", { level: 1, name: "Dr Besma Moussaoui" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Prendre rendez-vous" }),
    ).toBeTruthy();
    const call = screen.getByRole("link", { name: "Appeler la clinique" });
    expect(call.getAttribute("href")).toBe("tel:+213793035893");
    expect(
      screen.getByAltText("Portrait du Dr Besma Moussaoui, orthodontiste à Rouiba"),
    ).toBeTruthy();

    // One ambient canvas (fluid orb) — no other canvases, no scroll cue.
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(screen.queryByText("Faites défiler")).toBeNull();
    // Old slop copy is gone, verified rating is in.
    expect(screen.queryByText("4,9/5 sur Google")).toBeNull();
    expect(screen.getByText("4,8/5 sur Google · 37 avis")).toBeTruthy();
    unmount();
  });

  it("renders translated copy (en + ar)", () => {
    const { unmount } = renderHero("en", en);
    expect(
      screen.getByRole("heading", { level: 1, name: "Dr Besma Moussaoui" }),
    ).toBeTruthy();
    expect(
      screen.getByAltText("Portrait of Dr Besma Moussaoui, orthodontist in Rouiba"),
    ).toBeTruthy();
    expect(screen.getByText("4.8/5 on Google · 37 reviews")).toBeTruthy();
    unmount();

    renderHero("ar", ar);
    expect(
      screen.getByRole("heading", { level: 1, name: "Dr Besma Moussaoui" }),
    ).toBeTruthy();
    expect(
      screen.getByAltText("صورة الدكتورة بسمة موساوي، أخصائية تقويم الأسنان في الرويبة"),
    ).toBeTruthy();
    unmount();
  });
});
