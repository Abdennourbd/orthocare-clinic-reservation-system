import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "../globals.css";

// Dashboard root layout — FR only (plan.md §Admin dashboard language).
// Explicit dir="ltr" so RTL never leaks in if public locales change later.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// The mono face lives here (admin tables/IDs use it heavily); the public
// layout skips it so visitors never download it.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html lang="fr" dir="ltr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
