import { redirect } from "next/navigation";
import LoginForm from "@/components/admin/LoginForm";
import { getStaffFromCookies } from "@/lib/auth/guard";

// Task 12 — dashboard login page. Un-guarded on purpose; the proxy redirects
// here when /admin is visited without a session, and back to /admin when a
// valid session already exists.

export default async function LoginPage() {
  const staff = await getStaffFromCookies();
  if (staff) redirect("/admin");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <LoginForm />
    </main>
  );
}
