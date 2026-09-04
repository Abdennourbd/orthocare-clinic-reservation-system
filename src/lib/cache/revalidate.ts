import { revalidateTag } from "next/cache";
import { reportError } from "@/lib/monitoring/reportError";

/**
 * Fire-and-forget cache invalidation that can never turn a committed write
 * into a 500. `revalidateTag` runs after the DB write inside the same route —
 * if it ever threw, the client would retry into a 409 (SLUG_TAKEN,
 * SERVICE_IN_USE…) for a write that already happened. Same discipline as
 * `logActionSafe` / `runSideEffect`: the primary write always wins.
 *
 * Drop-in for `revalidateTag(tag, profile)`: the profile argument is accepted
 * and ignored (this repo always uses "max").
 */
export function revalidateTagSafe(tag: string, ..._rest: unknown[]): void {
  try {
    revalidateTag(tag, "max");
  } catch (e) {
    reportError("revalidate_tag_failed", e);
  }
}
