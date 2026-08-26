import { getPrisma } from "@/lib/db";

// Message templates live in the `messageTemplates` Setting (editable from the
// dashboard, Task 21), keyed by a stable template key. The booking-received
// template is French-only for now (Task 7 decision); per-locale templates and
// the remaining keys (confirmation, reminder, …) land with their tasks.
//
// Built-in defaults keep the system working even before the Setting is seeded.

export const DEFAULT_MESSAGE_TEMPLATES = {
  /** A new online booking is a REQUEST, not a confirmation. The clinic still
   * has to call. The wording must never say "confirmé". */
  bookingReceived:
    "Bonjour {firstName}, votre demande de rendez-vous {serviceName} le {date} à {time} a bien été reçue. La clinique vous appellera au {phone} pour la confirmer. Ortho'Care Clinic",
  /** Sent when the clinic confirms after the phone call (Task 14). Carries the
   * self-service link (Task 8) to cancel or reschedule. */
  confirmation:
    "Bonjour {firstName}, votre rendez-vous {serviceName} le {date} à {time} est confirmé. Pour le déplacer ou l'annuler : {selfServiceLink} Ortho'Care Clinic",
  /** Sent when the appointment is cancelled by the patient via the link (Task
   * 8) or by staff (Task 14). No self-service link — nothing left to manage. */
  cancelled:
    "Bonjour {firstName}, votre rendez-vous {serviceName} du {date} à {time} a été annulé. Ortho'Care Clinic",
  /** Sent after a reschedule (Task 8/14). Carries the ROTATED self-service
   * link for the new appointment. */
  reschedule:
    "Bonjour {firstName}, votre rendez-vous {serviceName} a été déplacé du {oldDate} à {oldTime} au {newDate} à {newTime}. Pour le gérer : {selfServiceLink} Ortho'Care Clinic",
} as const;

export type MessageTemplateKey = keyof typeof DEFAULT_MESSAGE_TEMPLATES;

type TemplateVars = Record<string, string | number>;

/**
 * Read a template from Settings, falling back to the built-in default when the
 * Setting is missing or the key is absent (admin-editable content must never
 * break a send).
 */
export async function readMessageTemplate(
  key: MessageTemplateKey,
): Promise<string> {
  const setting = await getPrisma().setting.findUnique({
    where: { key: "messageTemplates" },
  });
  const value = setting?.value;
  if (value && typeof value === "object" && key in value) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return DEFAULT_MESSAGE_TEMPLATES[key];
}

/**
 * Substitute `{placeholder}` tokens. Unknown tokens are left verbatim (a
 * template edited in Settings must never crash a send).
 */
export function renderTemplate(
  template: string,
  vars: TemplateVars,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}