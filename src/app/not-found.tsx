import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-8">
      <Card className="max-w-md w-full">
        <CardContent className="space-y-4 py-10 text-center">
          <p className="font-brand-mono text-5xl font-semibold text-[var(--slate)]">404</p>
          <h1 className="font-brand-serif text-2xl font-medium text-[var(--navy)]">Page not found</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            The page you are looking for does not exist or has been moved.
          </p>
          <Button asChild variant="primary">
            <Link href="/">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
