import type { RateLimitOptions } from "@/lib/security/rateLimit";

// Task 13 étape 5 tour 2 (ortho-security MAJEUR-1) — shared write budget for
// every Patient/Visit mutation: POST /api/admin/patients, PATCH /[id] and
// POST /[id]/visits. Extracted here so the 30/5min figure is declared once,
// not re-declared per route file (POST /api/admin/patients originally had
// its own local `WRITE_RATE_LIMIT`, and the two new PATCH/POST /visits
// guards in this tour would otherwise have been a third and fourth copy).
// Session-userId-keyed, never IP-keyed — same reasoning as the read budget:
// a single-site clinic sits behind one shared public IP, so an IP-keyed
// limit would either do nothing (one shared bucket for the whole front desk)
// or lock the entire clinic out from one bad actor's traffic.
export const PATIENTS_WRITE_RATE_LIMIT: RateLimitOptions = {
  limit: 30,
  windowMs: 5 * 60_000,
};
