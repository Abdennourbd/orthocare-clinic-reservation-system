import { describe, it, expect } from "vitest";
import {
  createGameState,
  hoverAt,
  isWon,
  progress,
  REQUIRED_PASSES,
} from "../src/lib/game/toothBrush";

const W = 640;
const H = 400;
// Centre zone: middle 60% => x in [128, 512].
const LEFT = 50;
const INSIDE = W / 2;
const RIGHT = 620;

describe("ToothBrush Logic (whitening reveal)", () => {
  it("starts with no passes and is not won", () => {
    const state = createGameState(W, H);
    expect(state.passes).toBe(0);
    expect(state.zoneX).toBeCloseTo(128);
    expect(state.zoneW).toBeCloseTo(384);
    expect(isWon(state)).toBe(false);
    expect(progress(state)).toBe(0);
  });

  it("counts a single left-to-right sweep across the centre zone", () => {
    let state = createGameState(W, H);
    state = hoverAt(state, LEFT);
    state = hoverAt(state, INSIDE);
    state = hoverAt(state, RIGHT);
    expect(state.passes).toBe(1);
    expect(progress(state)).toBeCloseTo(1 / REQUIRED_PASSES);
  });

  it("counts a right-to-left sweep as well", () => {
    let state = createGameState(W, H);
    state = hoverAt(state, RIGHT);
    state = hoverAt(state, INSIDE);
    state = hoverAt(state, LEFT);
    expect(state.passes).toBe(1);
  });

  it("counts a fast jump across the zone without intermediate points", () => {
    let state = createGameState(W, H);
    state = hoverAt(state, LEFT);
    state = hoverAt(state, RIGHT);
    expect(state.passes).toBe(1);
  });

  it("does not count hovering that stays inside the zone", () => {
    let state = createGameState(W, H);
    state = hoverAt(state, INSIDE);
    state = hoverAt(state, INSIDE + 20);
    state = hoverAt(state, INSIDE - 20);
    expect(state.passes).toBe(0);
  });

  it("does not count hovering that stays on one side of the zone", () => {
    let state = createGameState(W, H);
    state = hoverAt(state, LEFT);
    state = hoverAt(state, LEFT + 20);
    state = hoverAt(state, LEFT + 40);
    expect(state.passes).toBe(0);

    state = createGameState(W, H);
    state = hoverAt(state, RIGHT);
    state = hoverAt(state, RIGHT - 10);
    state = hoverAt(state, RIGHT - 30);
    expect(state.passes).toBe(0);
  });

  it("does not count entering and leaving on the same side", () => {
    let state = createGameState(W, H);
    state = hoverAt(state, LEFT);
    state = hoverAt(state, INSIDE);
    state = hoverAt(state, LEFT);
    expect(state.passes).toBe(0);
  });

  it("wins after three full sweeps in alternating directions", () => {
    let state = createGameState(W, H);
    state = hoverAt(state, LEFT);
    state = hoverAt(state, INSIDE);
    state = hoverAt(state, RIGHT);
    state = hoverAt(state, LEFT);
    state = hoverAt(state, RIGHT);
    state = hoverAt(state, LEFT);
    expect(state.passes).toBe(REQUIRED_PASSES);
    expect(isWon(state)).toBe(true);
    expect(progress(state)).toBe(1);
  });

  it("never exceeds the required pass count", () => {
    let state = createGameState(W, H);
    for (let i = 0; i < 10; i++) {
      state = hoverAt(state, LEFT);
      state = hoverAt(state, INSIDE);
      state = hoverAt(state, RIGHT);
    }
    expect(state.passes).toBe(REQUIRED_PASSES);
    expect(isWon(state)).toBe(true);
  });
});