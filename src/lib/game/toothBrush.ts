export type GameState = { width: number; height: number; plaque: number };

export function createGameState(width: number, height: number): GameState {
  return { width, height, plaque: 100 };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function brushAt(state: GameState, _x: number, _y: number, _radius: number): GameState {
  return { ...state, plaque: Math.max(0, state.plaque - 20) };
}

export function isClean(state: GameState): boolean {
  return state.plaque <= 0;
}
