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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (db as any)
    .from("events")
    .select(`
      id, title, start_at, status, created_by, venue_id, notes, created_at,
      venue:venue_id(name),
      creator:created_by(id, full_name, email)
    `)
    .eq("status", "pending_approval")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  type Row = {
    id: string;
    title: string;
    start_at: string;
    notes: string | null;
    venue: { name: string | null } | Array<{ name: string | null }> | null;
    creator: { full_name: string | null; email: string | null } | Array<{ full_name: string | null; email: string | null }> | null;
  };
  const proposals = ((rows ?? []) as Row[]).map((r) => {
    const venue = Array.isArray(r.venue) ? r.venue[0] : r.venue;
    const creator = Array.isArray(r.creator) ? r.creator[0] : r.creator;
    return {
      id: r.id,
      title: r.title,
      startAt: r.start_at,
      notes: r.notes,
      venueName: venue?.name ?? "Unknown venue",
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
