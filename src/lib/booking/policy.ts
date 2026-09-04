import { getPrisma } from "@/lib/db";
import type { BookingPolicyValue } from "./loadSlotContext";

// Reads the admin-editable booking-policy settings (Task 3b) and the consent
// version, with documented defaults. The POST /api/appointments route uses
// these for watch-date validation and for storing the patient's consent.

export type BookingPolicy = {
  minLeadTimeMinutes: number;
  maxHorizonDays: number;
  pendingExpiryHours: number;
  clinicTimezone: string;
};

export async function readBookingPolicy(): Promise<BookingPolicy> {
  const setting = await getPrisma().setting.findUnique({
    where: { key: "bookingPolicy" },
  });
  const value = (setting?.value ?? {}) as BookingPolicyValue;
  // Type-guarded: a wrongly-typed admin value (e.g. a string where a number
  // belongs) falls back to the default instead of poisoning lead-time,
  // horizon and expiry checks downstream.
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const str = (v: unknown, fallback: string): string =>
    typeof v === "string" && v.length > 0 ? v : fallback;
  return {
    pendingExpiryHours: num(value.pendingExpiryHours, 24),
    minLeadTimeMinutes: num(value.minLeadTimeMinutes, 120),
    maxHorizonDays: num(value.maxHorizonDays, 90),
    clinicTimezone: str(value.clinicTimezone, "Africa/Algiers"),
  };
}

/** The current consent version patients must agree to (Setting `consentVersion`). */
export async function readConsentVersion(): Promise<string> {
  const setting = await getPrisma().setting.findUnique({
    where: { key: "consentVersion" },
  });
  const value = setting?.value;
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "version" in value) {
    const v = (value as { version?: unknown }).version;
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "1.0";
}