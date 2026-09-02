import { describe, it, expect } from "vitest";
import {
  DEFAULT_MESSAGE_TEMPLATES,
  readMessageTemplate,
  renderTemplate,
} from "./templates";
import { getPrisma } from "@/lib/db";

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

describe("delay template (Task 16)", () => {
  it("renders the firstName, time and delayMinutes substitutions", () => {
    const out = renderTemplate(DEFAULT_MESSAGE_TEMPLATES.delay, {
      firstName: "Sara",
      time: "11:00",
      delayMinutes: 20,
    });
    expect(out).toBe(
      "Bonjour Sara, votre rendez-vous de 11:00 aujourd'hui est retardé d'environ 20 minutes. Ortho'Care Clinic",
    );
  });

  it("leaves unknown placeholders verbatim (existing renderTemplate behavior)", () => {
    // An admin-edited template may carry a placeholder the dispatcher never
    // supplies ({serviceName} here) — it must come through untouched, not
    // crash the send.
    const out = renderTemplate(
      `${DEFAULT_MESSAGE_TEMPLATES.delay} Service : {serviceName}`,
      { firstName: "Sara", time: "11:00", delayMinutes: 20 },
    );
    expect(out).toBe(
      "Bonjour Sara, votre rendez-vous de 11:00 aujourd'hui est retardé d'environ 20 minutes. Ortho'Care Clinic Service : {serviceName}",
    );
  });
});

describe("readMessageTemplate", () => {
  it("returns the Setting override when messageTemplates.delay exists", async () => {
    await getPrisma().setting.create({
      data: {
        key: "messageTemplates",
        value: { delay: "Retard personnalisé pour {firstName}" },
      },
    });

    expect(await readMessageTemplate("delay")).toBe(
      "Retard personnalisé pour {firstName}",
    );
  });

  it("falls back to the built-in default when the Setting is missing", async () => {
    expect(await readMessageTemplate("delay")).toBe(
      DEFAULT_MESSAGE_TEMPLATES.delay,
    );
  });
});

describe("DEFAULT_MESSAGE_TEMPLATES", () => {
  it("booking-received wording is a request, never a confirmation", () => {
    const tpl = DEFAULT_MESSAGE_TEMPLATES.bookingReceived.toLowerCase();
    expect(tpl).toContain("reçue");
    expect(tpl).not.toContain("confirmé");
    expect(tpl).toContain("confirmer");
  });

  it("reminder wording is a rappel, never a confirmation", () => {
    const tpl = DEFAULT_MESSAGE_TEMPLATES.reminder.toLowerCase();
    expect(tpl).toContain("rappel");
    expect(tpl).not.toContain("confirmé");
  });

  it("no-show wording tells the patient they missed it, never that it was confirmed", () => {
    const tpl = DEFAULT_MESSAGE_TEMPLATES.noShow.toLowerCase();
    expect(tpl).toContain("n'êtes pas venu");
    expect(tpl).not.toContain("confirmé");
  });

  it("expired wording explains the auto-cancellation and says the booking was NOT confirmed", () => {
    const tpl = DEFAULT_MESSAGE_TEMPLATES.expired.toLowerCase();
    expect(tpl).toContain("n'a pas été confirmée");
    expect(tpl).toContain("annulée");
  });
});