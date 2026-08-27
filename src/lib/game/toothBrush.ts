// Pure logic for the decorative whitening-reveal mini-game. No DOM, no canvas —
// fully unit-testable. The canvas component renders this state; the math lives
// here so the reveal/win behaviour can be verified without a browser.

/** Full sweeps across the centre zone needed to win. */
export const REQUIRED_PASSES = 3;

/** Horizontal fraction of the canvas the centre "teeth" zone occupies. */
export const ZONE_FRACTION = 0.6;

export type GameState = {
  width: number;
  height: number;
  /** Centre zone (full height, middle of the width) where the teeth are. */
  zoneX: number;
  zoneW: number;
  /** Last pointer x, used to detect which side a sweep came from. */
  prevX: number;
  /** Side the current sweep entered the zone from; null when outside. */
  sweepSide: "left" | "right" | null;
  /** Completed full sweeps across the zone. */
  passes: number;
  /** Soft reveal radius for the visual layer. */
  brushRadius: number;
};

const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Build the initial state: a centre zone spanning the middle `ZONE_FRACTION`
 * of the width, full height, no passes yet.
 */
export function createGameState(
  width: number,
  height: number,
): GameState {
  const zoneW = width * ZONE_FRACTION;
  const zoneX = (width - zoneW) / 2;

  return {
    width,
    height,
    zoneX,
    zoneW,
    prevX: width / 2,
    sweepSide: null,
    passes: 0,
    brushRadius: Math.max(24, Math.min(48, width * 0.055)),
  };
}

const inZone = (state: GameState, x: number) =>
  x >= state.zoneX && x <= state.zoneX + state.zoneW;

/**
 * Track the pointer and count a pass whenever it sweeps across the centre
 * zone from one side to the other (either direction). Returns a new state
 * (immutable).
 */
export function hoverAt(state: GameState, x: number): GameState {
  let { sweepSide, passes } = state;
  const prevX = state.prevX;

  // Direct jump from one side to the other (very fast mouse): counts once.
  const jumpedLeft = x < state.zoneX && prevX > state.zoneX + state.zoneW;
  const jumpedRight = x > state.zoneX + state.zoneW && prevX < state.zoneX;
  if (jumpedLeft || jumpedRight) {
    passes = Math.min(REQUIRED_PASSES, passes + 1);
    sweepSide = null;
    return { ...state, prevX: x, sweepSide, passes };
  }

  if (inZone(state, x)) {
    // Entered the zone from outside: remember which side.
    if (sweepSide === null) {
      sweepSide = prevX < state.zoneX ? "left" : "right";
    }
  } else if (sweepSide !== null) {
    // Exited the zone on the opposite side from where we entered: pass done.
    if (x < state.zoneX && sweepSide === "right") {
      passes = Math.min(REQUIRED_PASSES, passes + 1);
    } else if (x > state.zoneX + state.zoneW && sweepSide === "left") {
      passes = Math.min(REQUIRED_PASSES, passes + 1);
    }
    sweepSide = null;
  }

  return { ...state, prevX: x, sweepSide, passes };
}

/** True once `REQUIRED_PASSES` full sweeps have been completed. */
export function isWon(state: GameState): boolean {
  return state.passes >= REQUIRED_PASSES;
}

/** Reveal progress as 0..1 (1 = result fully revealed). */
export function progress(state: GameState): number {
  return clamp(state.passes / REQUIRED_PASSES, 0, 1);
}