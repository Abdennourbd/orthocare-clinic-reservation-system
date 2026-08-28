import { redirect } from "next/navigation";
import ChangePasswordForm from "@/components/admin/ChangePasswordForm";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 12 — forced / voluntary password change screen. Lives OUTSIDE the
// (dashboard) route group so the mustChangePassword redirect cannot loop.

export default async function ChangePasswordPage() {
  const staff = await getStaffFromCookies();
  if (!staff) redirect("/admin/login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <ChangePasswordForm />
    </main>
  );
}
