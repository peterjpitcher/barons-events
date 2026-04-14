"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createArtist, setArtistArchived, updateArtist } from "@/lib/artists";
import { getFieldErrors } from "@/lib/form-errors";
import type { ActionResult as BaseActionResult } from "@/lib/types";
import { canManageArtists } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";

type ActionResult = BaseActionResult & {
  artist?: {
    id: string;
    name: string;
    artistType: string;
    email: string | null;
    phone: string | null;
    description: string | null;
    isArchived?: boolean;
  };
};

const artistSchema = z.object({
  artistId: z.string().uuid().optional(),
  name: z.string().min(2, "Add an artist name").max(120, "Keep the name under 120 characters"),
  artistType: z.enum(["artist", "band", "host", "dj", "comedian", "other"]),
  email: z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    z.string().email("Use a valid email address").optional()
  ),
  phone: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    },
    z.string().max(40, "Keep phone details brief").optional()
  ),
  description: z.preprocess(
    (value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    },
    z.string().max(1000, "Keep description under 1000 characters").optional()
  )
});


export async function createArtistAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageArtists(user.role)) {
    return { success: false, message: "You don't have permission to create artists." };
  }

  const parsed = artistSchema.omit({ artistId: true }).safeParse({
    name: formData.get("name"),
    artistType: formData.get("artistType"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    description: formData.get("description")
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Check the highlighted fields.",
      fieldErrors: getFieldErrors(parsed.error)
    };
  }

  try {
    const created = await createArtist({
      ...parsed.data,
      createdBy: user.id
    });
    recordAuditLogEntry({
      entity: "artist",
      entityId: created.id,
      action: "artist.created",
      actorId: user.id,
      meta: { name: created.name, artistType: created.artist_type }
    }).catch(() => {});
    revalidatePath("/artists");
    revalidatePath("/events/new");
    return {
      success: true,
      message: "Artist added.",
      artist: {
        id: created.id,
        name: created.name,
        artistType: created.artist_type,
        email: created.email,
        phone: created.phone,
        description: created.description,
        isArchived: created.is_archived
      }
    };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not add the artist right now." };
  }
}

export async function updateArtistAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageArtists(user.role)) {
    return { success: false, message: "You don't have permission to update artists." };
  }

  const parsed = artistSchema.safeParse({
    artistId: formData.get("artistId"),
    name: formData.get("name"),
    artistType: formData.get("artistType"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    description: formData.get("description")
  });

  if (!parsed.success || !parsed.data.artistId) {
    return {
      success: false,
      message: parsed.success ? "Missing artist reference." : "Check the highlighted fields.",
      fieldErrors: parsed.success ? undefined : getFieldErrors(parsed.error)
    };
  }

  try {
    await updateArtist(parsed.data.artistId, {
      name: parsed.data.name,
      artistType: parsed.data.artistType,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      description: parsed.data.description ?? null
    });
    recordAuditLogEntry({
      entity: "artist",
      entityId: parsed.data.artistId,
      action: "artist.updated",
      actorId: user.id,
      meta: { name: parsed.data.name }
    }).catch(() => {});
    revalidatePath("/artists");
    revalidatePath(`/artists/${parsed.data.artistId}`);
    revalidatePath("/events/new");
    return { success: true, message: "Artist updated." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not update the artist right now." };
  }
}

const archiveSchema = z.object({
  artistId: z.string().uuid()
});

export async function archiveArtistAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageArtists(user.role)) {
    return { success: false, message: "You don't have permission to archive artists." };
  }

  const parsed = archiveSchema.safeParse({
    artistId: formData.get("artistId")
  });
  if (!parsed.success) {
    return { success: false, message: "Missing artist reference." };
  }

  try {
    await setArtistArchived(parsed.data.artistId, true);
    recordAuditLogEntry({
      entity: "artist",
      entityId: parsed.data.artistId,
      action: "artist.archived",
      actorId: user.id,
      meta: {}
    }).catch(() => {});
    revalidatePath("/artists");
    revalidatePath(`/artists/${parsed.data.artistId}`);
    revalidatePath("/events/new");
    revalidatePath("/settings");
    return { success: true, message: "Artist archived. Restore it any time from Settings." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not archive the artist right now." };
  }
}

export async function restoreArtistAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  // Intentionally planner-only: venue managers can archive but must
  // escalate to a planner to restore. The restore UI is on /settings (planner-only).
  if (user.role !== "central_planner") {
    return { success: false, message: "Only planners can restore archived artists." };
  }

  const parsed = archiveSchema.safeParse({
    artistId: formData.get("artistId")
  });
  if (!parsed.success) {
    return { success: false, message: "Missing artist reference." };
  }

  try {
    await setArtistArchived(parsed.data.artistId, false);
    recordAuditLogEntry({
      entity: "artist",
      entityId: parsed.data.artistId,
      action: "artist.restored",
      actorId: user.id,
      meta: {}
    }).catch(() => {});
    revalidatePath("/artists");
    revalidatePath(`/artists/${parsed.data.artistId}`);
    revalidatePath("/events/new");
    revalidatePath("/settings");
    return { success: true, message: "Artist restored." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not restore the artist right now." };
  }
}
