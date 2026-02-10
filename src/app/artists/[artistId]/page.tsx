import { notFound, redirect } from "next/navigation";
import { ArtistDetailEditor } from "@/components/artists/artist-detail-editor";
import { getCurrentUser } from "@/lib/auth";
import { getArtistDetail } from "@/lib/artists";

export default async function ArtistDetailPage({ params }: { params: Promise<{ artistId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    redirect("/");
  }

  const { artistId } = await params;
  const artist = await getArtistDetail(artistId);
  if (!artist) {
    notFound();
  }

  return <ArtistDetailEditor artist={artist} />;
}
