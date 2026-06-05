import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LockKeyhole } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-8">
      <Card className="max-w-md w-full">
        <CardContent className="space-y-4 py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-tint)] text-[var(--slate-dark)]">
            <LockKeyhole className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="font-brand-serif text-2xl font-medium text-[var(--navy)]">Access denied</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            You do not have permission to view this page. If you believe this is a mistake, please contact your administrator.
          </p>
          <Button asChild variant="primary" className="h-11 w-full">
            <Link href="/">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
