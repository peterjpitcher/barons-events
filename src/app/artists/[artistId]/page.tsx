import { notFound, redirect } from "next/navigation";
import { ArtistDetailEditor } from "@/components/artists/artist-detail-editor";
import { getCurrentUser } from "@/lib/auth";
import { getArtistDetail } from "@/lib/artists";
import { canManageArtists } from "@/lib/roles";

export default async function ArtistDetailPage({ params }: { params: Promise<{ artistId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageArtists(user.role, user.venueId)) {
    redirect("/unauthorized");
  }

  const { artistId } = await params;
  const artist = await getArtistDetail(artistId);
  if (!artist) {
    notFound();
  }

  return <ArtistDetailEditor artist={artist} />;
}
