// Task 13 étape 8 (ortho-tester) — extra setup file for React component
// tests only (`*.test.tsx`), loaded IN ADDITION to `tests/setup.ts` (never
// instead of it — CLAUDE.md forbids touching that file, and its per-test
// `TRUNCATE` guard against the production Neon database must keep running
// unmodified for every test file, jsdom or not).
//
// This file only registers `@testing-library/jest-dom`'s matchers
// (`toBeDisabled`, `toHaveTextContent`, ...) so component tests can assert
// on rendered DOM the same way the rest of the ecosystem does. It touches no
// database and defines no lifecycle hooks.
import "@testing-library/jest-dom/vitest";
