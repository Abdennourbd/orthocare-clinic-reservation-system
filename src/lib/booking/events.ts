/**
 * In-process slot-freed event bus.
 *
 * `releaseSlot()` emits a `slot-freed` event after it commits; Task 17
 * (waitlist) will subscribe and notify eligible patients. Because self-service
 * (Task 8) and staff (Task 14) cancels both route through `releaseSlot()`,
 * the event fires on every cancellation by construction.
 *
 * Deliberately a simple synchronous in-process emitter — no external broker.
 * The waitlist notification itself runs in the same request/process as the
 * cancellation, so in-process pub/sub is sufficient.
 */

export type SlotFreedEvent = {
  appointmentId: string;
  /** The freed appointment's service — the waitlist matches on this. */
  serviceId: string;
  resourceId: string | null;
  startTime: Date;
  endTime: Date;
};

// Handlers may be sync or async; the async emitter awaits whatever they
// return (a plain value resolves immediately). `unknown` keeps test spies
// like `(e) => seen.push(e)` compiling without weakening the await.
type SlotFreedHandler = (event: SlotFreedEvent) => unknown;

const listeners = new Set<SlotFreedHandler>();

/** Subscribe to slot-freed events. Returns an unsubscribe function. */
export function onSlotFreed(handler: SlotFreedHandler): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

/** Emit a slot-freed event to all current subscribers. */
export function emitSlotFreed(event: SlotFreedEvent): void {
  for (const handler of listeners) {
    handler(event);
  }
}

/**
 * Emit and AWAIT all subscribers, bounded by `timeoutMs` (default 15s).
 * Serverless isolates can freeze once the HTTP response flushes, killing
 * in-flight notification work — so every production emit path
 * (`releaseSlot`, `rescheduleSlot`, self-service cancel) awaits this instead
 * of the fire-and-forget `emitSlotFreed`. A slow/throwing handler is logged
 * (PII-free: the event carries ids and timestamps only) and never rejects,
 * so notification trouble can never turn a cancellation into a 500.
 */
export async function emitSlotFreedAsync(
  event: SlotFreedEvent,
  timeoutMs = 15_000,
): Promise<void> {
  await Promise.all(
    [...listeners].map(async (handler) => {
      try {
        await withTimeout(Promise.resolve().then(() => handler(event)), timeoutMs);
      } catch (e) {
        console.warn(
          JSON.stringify({
            event: "slot_freed_handler_failed",
            error: e instanceof Error ? e.name : "unknown",
          }),
        );
      }
    }),
  );
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("slot-freed handler timeout")), ms);
  });
  return Promise.race([promise, timeout]).then(
    () => undefined,
    (e) => {
      throw e;
    },
  ).finally(() => clearTimeout(timer));
}
