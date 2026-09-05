// @vitest-environment jsdom
//
// Component test for TimeGrid (Task 6R, human-recipe correction "date
// visible" — plan.md §Refinement: Task 6 — Booking UI/UX).
//
// The bug this locks down: `dateLabel` was passed into TimeGrid but only
// ever consumed inside `aria-label`s on the slot buttons, so a screen-reader
// user heard which day the grid belonged to while a sighted user never saw
// it — switching days on the carousel (same opening hours every day in a
// fresh dev/test database) looked like the carousel was broken. A test that
// only reads an `aria-label` would pass on the old, broken markup too, so
// this asserts the date is present in the *visible text content* of the
// grid via `getByText`, which testing-library resolves against rendered DOM
// text nodes, not accessible-name computation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import TimeGrid, { type SlotDto } from "./TimeGrid";
import fr from "../../../../messages/fr.json";
import ar from "../../../../messages/ar.json";

afterEach(() => {
  cleanup();
});

const AVAILABLE: SlotDto[] = [
  { startUTC: "2026-09-08T09:00:00.000Z", localTime: "10:00" },
];
const OCCUPIED: SlotDto[] = [
  { startUTC: "2026-09-08T10:00:00.000Z", localTime: "11:00" },
];

function renderGrid(props: {
  dateLabel: string;
  locale?: "fr" | "ar";
  available?: SlotDto[];
  occupied?: SlotDto[];
}) {
  const {
    dateLabel,
    locale = "fr",
    available = AVAILABLE,
    occupied = OCCUPIED,
  } = props;
  const messages = locale === "ar" ? ar : fr;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TimeGrid
        dateLabel={dateLabel}
        available={available}
        occupied={occupied}
        selectedStartUTC={null}
        onSelect={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("TimeGrid", () => {
  it("shows the active day's date in the visible text of the grid, not only in aria-labels", () => {
    renderGrid({ dateLabel: "mardi 8 septembre" });
    // Visible text query — this is exactly what the human tester could not
    // find on screen. Using a substring matcher because the legend wraps
    // the date inside a fuller sentence ("Créneaux du <date>").
    expect(
      screen.getByText((_, node) =>
        node?.textContent === "Créneaux du mardi 8 septembre",
      ),
    ).toBeInTheDocument();
  });

  it("updates the visible date when the active day changes (rerender with a new dateLabel)", () => {
    const { rerender } = renderGrid({ dateLabel: "mardi 8 septembre" });
    expect(screen.getByText(/mardi 8 septembre/)).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <TimeGrid
          dateLabel="mercredi 9 septembre"
          available={AVAILABLE}
          occupied={OCCUPIED}
          selectedStartUTC={null}
          onSelect={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/mardi 8 septembre/)).not.toBeInTheDocument();
    expect(screen.getByText(/mercredi 9 septembre/)).toBeInTheDocument();
  });

  it("renders the visible date label in Arabic too (RTL locale)", () => {
    renderGrid({ dateLabel: "الثلاثاء 8 سبتمبر", locale: "ar" });
    expect(screen.getByText(/الثلاثاء 8 سبتمبر/)).toBeInTheDocument();
  });

  it("still marks reserved slots with a visible non-color indicator alongside the date heading", () => {
    renderGrid({ dateLabel: "mardi 8 septembre" });
    // Guard against a regression where adding the heading would remove or
    // hide the existing "Réservé" text label on occupied slots.
    expect(screen.getByText("Réservé")).toBeInTheDocument();
  });
});
