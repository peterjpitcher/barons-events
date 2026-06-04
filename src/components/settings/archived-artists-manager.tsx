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
  canEdit: boolean;
};

export function ArchivedArtistsManager({ artists, canEdit }: ArchivedArtistsManagerProps) {
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
    <div className="data-table-shell">
      <table className="data-table min-w-full">
        <thead>
          <tr className="bg-[var(--canvas-2)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
            <th className="px-4 py-3">Artist</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Contact</th>
            <th className="px-4 py-3 text-right">{canEdit ? "Actions" : ""}</th>
          </tr>
        </thead>
        <tbody>
          {artists.map((artist) => (
            <tr key={artist.id} className="border-t border-[var(--hair)]">
              <td className="px-4 py-3 text-sm font-medium text-[var(--ink)]">{artist.name}</td>
              <td className="px-4 py-3 text-sm">{artist.artistType}</td>
              <td className="px-4 py-3 text-sm text-subtle">{[artist.email, artist.phone].filter(Boolean).join(" · ") || "No contact info"}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/artists/${artist.id}`}>View</Link>
                  </Button>
                  {canEdit ? (
                    <form action={formAction}>
                      <input type="hidden" name="artistId" value={artist.id} />
                      <SubmitButton label="Restore" pendingLabel="Restoring..." size="sm" />
                    </form>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
