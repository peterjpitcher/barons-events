import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/actions/auth";
import { getSession } from "@/lib/auth";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = {
  title: "Sign in · Barons Events",
  description: "Enter your Barons workspace details to continue."
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  const query = await searchParams;
  const errorMessage = query.error === "auth"
    ? "Those details didn't match."
    : query.error === "invalid"
      ? "Please check your email and password."
      : null;

  if (session) {
    redirect("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4 py-12">
      <Card className="w-full max-w-md shadow-soft">
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>
            Use your Barons email and password. If you&apos;re not sure, speak with the central planning
            team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signInAction} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {errorMessage ? <p className="text-sm text-[var(--color-antique-burgundy)]">{errorMessage}</p> : null}
            <SubmitButton label="Sign in" />
          </form>
          <p className="mt-6 text-sm text-muted">
            Locked out? <Link href="mailto:central.planner@barons.example" className="underline">Email the
            planners</Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
