import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PendingProposalRow } from "@/components/events/pending-proposal-row";

export const metadata = {
  title: "Pending proposals · BaronsHub",
  description: "Review and approve or reject event proposals."
};

export default async function PendingProposalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "administrator") redirect("/unauthorized");

  const db = createSupabaseAdminClient();
   
  const { data: rows } = await (db as any)
    .from("events")
    .select(`
      id, title, start_at, status, created_by, venue_id, notes, created_at,
      event_venues(venue_id, is_primary, venue:venues(id,name)),
      creator:created_by(id, full_name, email)
    `)
    .eq("status", "pending_approval")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  type RawAttachment = {
    venue_id: string;
    is_primary: boolean;
    venue: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  type Row = {
    id: string;
    title: string;
    start_at: string;
    notes: string | null;
    event_venues?: RawAttachment[] | null;
    creator: { full_name: string | null; email: string | null } | Array<{ full_name: string | null; email: string | null }> | null;
  };
  const proposals = ((rows ?? []) as Row[]).map((r) => {
    const creator = Array.isArray(r.creator) ? r.creator[0] : r.creator;
    const attachments = Array.isArray(r.event_venues) ? r.event_venues : [];
    const venues = attachments
      .map((a) => {
        const v = Array.isArray(a.venue) ? a.venue[0] : a.venue;
        return { name: v?.name ?? "Unknown venue", isPrimary: Boolean(a.is_primary) };
      })
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    const venueName = venues.length === 0
      ? "No venue"
      : venues.length === 1
        ? venues[0].name
        : `${venues[0].name} + ${venues.length - 1} more`;
    return {
      id: r.id,
      title: r.title,
      startAt: r.start_at,
      notes: r.notes,
      venueName,
      venueNames: venues.map((v) => v.name),
      creatorName: creator?.full_name ?? creator?.email ?? "Unknown"
    };
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pending proposals</CardTitle>
          <CardDescription>
            Review quick event proposals. Approving unlocks the full event form for the creator; rejecting closes
            the proposal with a reason.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {proposals.length === 0 ? (
            <p className="text-sm text-subtle">No pending proposals.</p>
          ) : (
            <ul className="space-y-3">
              {proposals.map((p) => (
                <PendingProposalRow key={p.id} proposal={p} />
              ))}
            </ul>
          )}
          <p className="mt-6 text-xs text-subtle">
            <Link href="/events" className="underline">← Back to events</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
