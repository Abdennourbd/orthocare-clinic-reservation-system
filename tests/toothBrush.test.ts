import { describe, it, expect } from "vitest";
import { createGameState, brushAt, isClean } from "../src/lib/game/toothBrush";

describe("ToothBrush Logic", () => {
  it("cleans plaque and detects win", () => {
    let state = createGameState(100, 100);
    expect(isClean(state)).toBe(false);
    
    for (let i = 0; i < 5; i++) {
      state = brushAt(state, 50, 50, 100);
    }
    
    expect(isClean(state)).toBe(true);
  });
});
