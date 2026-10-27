import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { homePath } from "@/lib/roles";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homePath(user.role));

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-sky-400 text-lg font-bold text-white shadow-lg shadow-accent/20">
            J
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Job Management System</h1>
            <p className="mt-1 text-sm text-muted">Sign in with your user ID to continue</p>
          </div>
        </div>
        <div className="card p-6 shadow-2xl shadow-black/40">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
