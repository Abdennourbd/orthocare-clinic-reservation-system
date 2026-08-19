import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Use process.env directly (not the env() helper) so commands that don't
  // need the database — like `prisma generate` during `npm install` — still
  // work even when DATABASE_URL is absent (e.g. Vercel's build step).
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
