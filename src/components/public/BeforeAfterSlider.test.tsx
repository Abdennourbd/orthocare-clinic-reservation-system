// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import BeforeAfterSlider from "./BeforeAfterSlider";

// G4 — interactive before/after comparison slider. Mechanics are isolated
// with dir="ltr" (a spatial widget behaves identically in every locale);
// labels stay localized. Keyboard: arrows ±4, Shift+arrows ±10, Home/End.

const props = {
  beforeSrc: "/images/beforewhitening.jpeg",
  afterSrc: "/images/afterwhitening.jpeg",
  beforeAlt: "Avant",
  afterAlt: "Après",
  beforeLabel: "Avant",
  afterLabel: "Après",
  sliderLabel: "Comparaison avant / après",
};

afterEach(() => {
  cleanup();
});

describe("BeforeAfterSlider", () => {
  it("renders both images and a slider handle at 50%", () => {
    render(<BeforeAfterSlider {...props} />);
    expect(screen.getByAltText("Avant")).toBeInTheDocument();
    expect(screen.getByAltText("Après")).toBeInTheDocument();
    const handle = screen.getByRole("slider", { name: "Comparaison avant / après" });
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Avant")).toBeInTheDocument();
    expect(screen.getByText("Après")).toBeInTheDocument();
  });

  it("moves with arrow keys and clamps at the edges", () => {
    render(<BeforeAfterSlider {...props} />);
    const handle = screen.getByRole("slider");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "54");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "50");
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "100");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "0");
  });

  it("moves in bigger steps with Shift held", () => {
    render(<BeforeAfterSlider {...props} />);
    const handle = screen.getByRole("slider");
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });
    expect(handle).toHaveAttribute("aria-valuenow", "60");
  });

  it("starts a drag from the handle itself (gesture bubbles to the track)", () => {
    // Regression: the handle once stopped pointer-event propagation, making
    // the one place users grab the only dead spot of the slider.
    render(<BeforeAfterSlider {...props} />);
    const handle = screen.getByRole("slider");
    const track = handle.closest("[dir='ltr']") as HTMLElement;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 100,
      width: 400,
    } as DOMRect);
    fireEvent.pointerDown(handle, { clientX: 180, pointerId: 1 });
    expect(handle).toHaveAttribute("aria-valuenow", "20");
  });
});
