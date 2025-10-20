import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DebriefForm } from "@/components/events/debrief-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";

export default async function DebriefPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const event = await getEventDetail(eventId);
  if (!event) {
    notFound();
  }

  const allowed =
    user.role === "central_planner" || (user.role === "venue_manager" && event.created_by === user.id);

  if (!allowed) {
    redirect("/");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Post-event debrief</CardTitle>
          <CardDescription>
            Keep it clear and simple—numbers help the planning team understand how the night performed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 rounded-[var(--radius)] bg-muted-surface px-4 py-3 text-sm text-subtle">
            <p>
              Event:{" "}
              <Link
                href={`/events/${event.id}`}
                className="font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-primary-600)]"
              >
                {event.title}
              </Link>{" "}
              ({new Date(event.start_at).toLocaleDateString("en-GB")})
            </p>
          </div>
          <DebriefForm eventId={event.id} defaults={event.debrief} />
        </CardContent>
      </Card>
    </div>
  );
}
