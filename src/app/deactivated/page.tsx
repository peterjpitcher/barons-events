import Link from "next/link";
import { UserX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Account Deactivated · BaronsHub 1.1",
};

export default function DeactivatedPage(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--burgundy-tint)] text-[var(--burgundy)]">
            <UserX className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="font-brand-serif text-2xl font-medium text-[var(--navy)]">Account deactivated</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            Your account has been deactivated by an administrator. If you believe this is an error, contact your administrator.
          </p>
          <Button asChild variant="primary" className="h-11 w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
