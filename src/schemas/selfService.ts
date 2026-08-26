import { z } from "zod";

// Shared request schema for the self-service reschedule endpoint (Task 8).
// Used by the route handler (server) and the token page form (client). The
// service is fixed by the appointment — only the new start instant is chosen;
// availability + booking policy (lead time, horizon, overlap) are re-checked
// atomically inside `rescheduleSlot` → `bookSlotInTx`.
export const rescheduleSchema = z.object({
  /** ISO-8601 UTC instant of the new slot. */
  startTime: z.string().datetime(),
});

export type RescheduleInput = z.infer<typeof rescheduleSchema>;