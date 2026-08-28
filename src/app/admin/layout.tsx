import type { ReactNode } from "react";
import "../globals.css";

// Dashboard root layout — FR only (plan.md §Admin dashboard language).
// Explicit dir="ltr" so RTL never leaks in if public locales change later.

export const metadata = {
  title: "Ortho'Care — Administration",
  description: "Tableau de bord interne Ortho'Care",
};

export default function AdminRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="fr" dir="ltr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
