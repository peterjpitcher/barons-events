import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function EventNotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <Card className="max-w-md w-full">
        <CardContent className="space-y-4 py-10 text-center">
          <p className="font-brand-mono text-5xl font-semibold text-[var(--slate)]">404</p>
          <h1 className="font-brand-serif text-2xl font-medium text-[var(--navy)]">Event not found</h1>
          <p className="text-sm text-[var(--ink-muted)]">
            This event does not exist or may have been removed.
          </p>
          <Button asChild variant="primary">
            <Link href="/events">Back to events</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
