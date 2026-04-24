import { notFound, redirect } from "next/navigation";
import { ArtistDetailEditor } from "@/components/artists/artist-detail-editor";
import { getCurrentUser } from "@/lib/auth";
import { getArtistDetail } from "@/lib/artists";
import { canViewArtists, canManageArtists } from "@/lib/roles";

export default async function ArtistDetailPage({ params }: { params: Promise<{ artistId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canViewArtists(user.role)) {
    redirect("/unauthorized");
  }

  const { artistId } = await params;
  const artist = await getArtistDetail(artistId);
  if (!artist) {
    notFound();
  }

  const canEdit = canManageArtists(user.role, user.venueId);

  return <ArtistDetailEditor artist={artist} canEdit={canEdit} />;
}
