// Task 14 — shared side-effect runner for the admin appointment routes.
// Messaging and other post-commit side effects must never fail the status
// change (or booking) they accompany: a failed SMS is logged and swallowed,
// exactly the discipline the self-service actions follow
// (src/lib/selfservice/actions.ts).

/** Run a side effect, swallowing failures so the primary write always wins. */
export async function runSideEffect<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.error("appointment side effect failed", e);
    return null;
  }
}
