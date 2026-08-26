import { describe, it, expect } from "vitest";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  renderTemplate,
} from "./templates";

describe("renderTemplate", () => {
  it("substitutes known placeholders", () => {
    const out = renderTemplate(
      "Bonjour {firstName}, le {date} à {time}",
      { firstName: "Sara", date: "29/08/2026", time: "11:00" },
    );
    expect(out).toBe("Bonjour Sara, le 29/08/2026 à 11:00");
  });

  it("leaves unknown placeholders verbatim (a bad template must not crash)", () => {
    const out = renderTemplate(
      "Bonjour {firstName} {missing}",
      { firstName: "Sara" },
    );
    expect(out).toBe("Bonjour Sara {missing}");
  });

  it("handles numeric values", () => {
    const out = renderTemplate("min {minutes}", { minutes: 30 });
    expect(out).toBe("min 30");
  });
});

describe("DEFAULT_MESSAGE_TEMPLATES", () => {
  it("booking-received wording is a request, never a confirmation", () => {
    const tpl = DEFAULT_MESSAGE_TEMPLATES.bookingReceived.toLowerCase();
    expect(tpl).toContain("reçue");
    expect(tpl).not.toContain("confirmé");
    expect(tpl).toContain("confirmer");
  });
});