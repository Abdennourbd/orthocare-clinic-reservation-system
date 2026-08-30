import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    // Task 13 étape 8 (ortho-tester) — the first admin React components in
    // this repo (PatientForm, PatientTimeline, AnonymizePatientAction, ...)
    // need to be rendered to prove their behavior (duplicate banner stays
    // inline, three timeline states, anonymize confirm gate). Every other
    // test in the suite is server/DB logic; `environmentMatchGlobs` was
    // removed in Vitest 4, so each `*.test.tsx` file opts into `jsdom`
    // itself via a `// @vitest-environment jsdom` docblock instead of
    // flipping the whole suite's default environment.
    environment: "node",
    // `tests/setup.ts` (the TRUNCATE guard, CLAUDE.md — never modified) runs
    // for every file as before; `tests/setupComponent.ts` only adds
    // `@testing-library/jest-dom` matchers for the new `*.test.tsx` files.
    setupFiles: ["./tests/setup.ts", "./tests/setupComponent.ts"],
    // Test files run serially because they share a single test Postgres
    // database. Parallel execution would let one suite's TRUNCATE in
    // `beforeEach` wipe another suite's data mid-run (flaky, order-dependent).
    fileParallelism: false,
    // Unit tests are colocated with source (e.g. engine.test.ts); integration
    // tests live under tests/. Exclude generated Prisma code and build output.
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
    exclude: ["node_modules/**", "src/generated/**", ".next/**"],
  },
});
