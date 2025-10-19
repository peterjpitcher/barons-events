import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/auth";

export default async function LoginPage() {
  const session = await getSession();

  if (session) {
    redirect("/");
  }

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-4xl flex-col justify-center gap-10 px-6 py-16">
      <div className="space-y-4 text-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-[var(--color-primary-500)]">
            EventHub · by Barons
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-primary-900)]">
            Welcome back
          </h1>
        </div>
        <p className="mx-auto max-w-2xl text-sm text-[var(--color-text-muted)]">
          Sign in to continue planning brighter events. Need access? Ask an Central planner or Ops admin to invite you and make sure your Supabase account is provisioned.
        </p>
      </div>

      <LoginForm />

      <div className="text-center text-sm text-[var(--color-text-subtle)]">
        <span>
          Having trouble? Contact the Ops team to reset access or resend your invite.
        </span>
      </div>
    </section>
  );
}
