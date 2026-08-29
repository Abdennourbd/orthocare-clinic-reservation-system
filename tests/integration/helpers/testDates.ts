// Shared clinic-local date helpers for booking integration tests.
//
// Why this exists: `bookSlot`/`createBooking` check working hours and lead
// time against the REAL wall clock (`new Date()`), never a mocked one.
// Hardcoding a calendar date (e.g. "2026-08-29") only survives until the
// environment's real "today" reaches that date, after which every booking on
// it starts failing with an unrelated SlotConflictError/409 — a
// pre-existing, environment-driven failure mode documented in
// .claude/agent-memory/ortho-builder/trap_hardcoded_test_dates_clock_drift.md.
// These helpers compute dates relative to `new Date()` instead, so the tests
// stay green regardless of when they run.
//
// The clinic also has a closed day (Friday, per every test file's
// `workingHours` fixture), so "tomorrow" is not always bookable. Rather than
// hardcode which weekday is closed — which would silently desync the moment
// a fixture changes — `nextOpenLocalDate`/`nextClosedLocalDate` read the
// actual `workingHours` Setting row already in the test DB (the same shape
// prisma/seed.ts installs), so they always agree with whatever schedule the
// calling test set up.
import { getPrisma } from "@/lib/db";
import { addClinicDays, getClinicDayOfWeek } from "@/lib/time/clinicTime";

/** Clinic-local (UTC+1, no DST) start instant for a local date + "HH:mm". */
export function localStart(localDate: string, hhmm: string): Date {
  return new Date(`${localDate}T${hhmm}:00.000+01:00`);
}

async function isOpenDay(localDate: string): Promise<boolean> {
  const setting = await getPrisma().setting.findUnique({
    where: { key: "workingHours" },
  });
  const hours = (setting?.value ?? {}) as Record<string, { closed?: boolean }>;
  return hours[getClinicDayOfWeek(localDate)]?.closed !== true;
}

/**
 * Next clinic-open calendar date at least `daysAhead` days from today, per
 * the `workingHours` Setting row already in the test DB. Throws (rather than
 * silently returning a closed day) if none is found within two weeks — that
 * would mean the workingHours fixture has no open days at all.
 */
export async function nextOpenLocalDate(daysAhead = 1): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  let candidate = addClinicDays(today, daysAhead);
  for (let i = 0; i < 14; i++) {
    if (await isOpenDay(candidate)) return candidate;
    candidate = addClinicDays(candidate, 1);
  }
  throw new Error(
    "nextOpenLocalDate: no open day found in the next 14 days — check the workingHours fixture",
  );
}

/**
 * Next CLOSED calendar date at least `daysAhead` days out — for tests that
 * assert a closed day is rejected.
 */
export async function nextClosedLocalDate(daysAhead = 1): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  let candidate = addClinicDays(today, daysAhead);
  for (let i = 0; i < 14; i++) {
    if (!(await isOpenDay(candidate))) return candidate;
    candidate = addClinicDays(candidate, 1);
  }
  throw new Error(
    "nextClosedLocalDate: no closed day found in the next 14 days — check the workingHours fixture",
  );
}

/** Convenience: an open clinic-local start time, `daysAhead` days out. */
export async function futureBookableLocalStart(
  hhmm: string,
  daysAhead = 5,
): Promise<Date> {
  const localDate = await nextOpenLocalDate(daysAhead);
  return localStart(localDate, hhmm);
}
