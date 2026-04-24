import { redirect } from "next/navigation";
import { ArtistsManager } from "@/components/artists/artists-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { listArtistsWithPerformance } from "@/lib/artists";
import { canViewArtists, canManageArtists } from "@/lib/roles";

export const metadata = {
  title: "Artists · Barons Events",
  description: "Manage recurring artists, bands, and hosts with performance history."
};

export default async function ArtistsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canViewArtists(user.role)) {
    redirect("/unauthorized");
  }

  const artists = await listArtistsWithPerformance();
  const canEdit = canManageArtists(user.role, user.venueId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Artists directory</CardTitle>
          <CardDescription>Track artists over time using debrief uplift and sentiment data.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-subtle">
            Link artists to events, then review their debrief performance so rebooking decisions stay data-driven.
          </p>
        </CardContent>
      </Card>
      <ArtistsManager artists={artists} canEdit={canEdit} />
    </div>
  );
}
