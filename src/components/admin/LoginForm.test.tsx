// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import LoginForm from "./LoginForm";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

function fetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  replace.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function fillAndSubmit(email = "a@orthocare.com", password = "secret123456") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Mot de passe"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
}

describe("LoginForm", () => {
  it("routes to the dashboard on success", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { user: { mustChangePassword: false } }),
    );
    render(<LoginForm />);
    fillAndSubmit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin"));
  });

  it("routes to the forced password-change screen on mustChangePassword", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(200, { user: { mustChangePassword: true } }),
    );
    render(<LoginForm />);
    fillAndSubmit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/admin/change-password"));
  });

  it("shows the server error inline on 401 without navigating", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      fetchOnce(401, { error: { message: "Identifiants invalides." } }),
    );
    render(<LoginForm />);
    fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Identifiants invalides.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("disables the submit button while pending", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}),
    );
    render(<LoginForm />);
    fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Connexion…" })).toBeDisabled(),
    );
  });
});
