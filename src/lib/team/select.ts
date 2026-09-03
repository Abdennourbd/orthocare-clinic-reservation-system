import type { Prisma } from "@/generated/prisma/client";

// Task 20 — shared select for team rows. Declared once here (not per route
// file) so the list, create, patch and reset paths cannot drift — a spread
// would serialize passwordHash, so every team read goes through this
// named-field list.
export const teamRowSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

export type TeamRow = Prisma.UserGetPayload<{ select: typeof teamRowSelect }>;
