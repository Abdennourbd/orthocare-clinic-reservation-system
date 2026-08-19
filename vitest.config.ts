import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
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
