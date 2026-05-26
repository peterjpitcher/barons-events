import { redirect } from "next/navigation";
import { ArtistsManager } from "@/components/artists/artists-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/design-primitives";
import { getCurrentUser } from "@/lib/auth";
import { listArtistsWithPerformance } from "@/lib/artists";
import { canViewArtists, canManageArtists } from "@/lib/roles";

export const metadata = {
  title: "Artists · BaronsHub 1.1",
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
    <div className="app-page">
      <PageHeader
        eyebrow="Programming"
        title="Artists directory"
        description="Track artists over time using debrief uplift and sentiment data."
        meta={<span>{artists.length} artist{artists.length === 1 ? "" : "s"}</span>}
      />
      <Card>
        <CardHeader>
          <CardTitle>Performance context</CardTitle>
          <CardDescription>Use linked event history to support rebooking decisions.</CardDescription>
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
