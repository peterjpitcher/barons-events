"use client";

import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { restoreArtistAction } from "@/actions/artists";
import type { ArtistOption } from "@/lib/artists";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";

type ArchivedArtistsManagerProps = {
  artists: ArtistOption[];
};

export function ArchivedArtistsManager({ artists }: ArchivedArtistsManagerProps) {
  const [state, formAction] = useActionState(restoreArtistAction, undefined);
  const router = useRouter();

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      router.refresh();
      return;
    }
    toast.error(state.message);
  }, [state, router]);

  if (!artists.length) {
    return <p className="text-sm text-subtle">No archived artists.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-white">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
            <th className="px-4 py-3">Artist</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {artists.map((artist) => (
            <tr key={artist.id} className="border-t border-[var(--color-border)]">
              <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{artist.name}</td>
              <td className="px-4 py-3 text-sm">{artist.artistType}</td>
              <td className="px-4 py-3 text-sm text-subtle">{[artist.email, artist.phone].filter(Boolean).join(" · ") || "No contact info"}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/artists/${artist.id}`}>View</Link>
                  </Button>
                  <form action={formAction}>
                    <input type="hidden" name="artistId" value={artist.id} />
                    <SubmitButton label="Restore" pendingLabel="Restoring..." size="sm" />
                  </form>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
