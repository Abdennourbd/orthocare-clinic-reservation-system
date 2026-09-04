// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ConfirmPanel from "./ConfirmPanel";

afterEach(cleanup);

describe("ConfirmPanel", () => {
  const base = {
    message: "Supprimer cet élément ?",
    confirmLabel: "Confirmer la suppression",
    pending: false,
    error: null as string | null,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("announces the question as an alert and focuses the confirm button", () => {
    const { container } = render(<ConfirmPanel {...base} />);
    expect(screen.getByText("Supprimer cet élément ?")).toBeInTheDocument();
    expect(
      container.querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Confirmer la suppression" })).toHaveFocus();
  });

  it("confirms and cancels through the buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmPanel {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la suppression" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape and shows pending + error states", () => {
    const onCancel = vi.fn();
    render(<ConfirmPanel {...base} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByText("Supprimer cet élément ?"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    cleanup();

    render(
      <ConfirmPanel
        {...base}
        onCancel={onCancel}
        pending
        pendingLabel="Suppression…"
        error="Échec réseau"
      />,
    );
    expect(screen.getByRole("button", { name: "Suppression…" })).toBeDisabled();
    expect(screen.getByText("Échec réseau")).toBeInTheDocument();
  });
});
