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

type SlotFreedHandler = (event: SlotFreedEvent) => void;

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
