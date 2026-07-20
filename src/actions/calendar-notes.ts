"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canCreateCalendarNote, canManageCalendarNote } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { normaliseOptionalText } from "@/lib/normalise";
import {
  createCalendarNoteSchema,
  updateCalendarNoteSchema,
  deleteCalendarNoteSchema,
} from "@/lib/validation";

export type CalendarNoteActionResult = {
  success: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  noteId?: string;
  updatedAt?: string;
};

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  error.issues.forEach((issue) => {
    const key = issue.path.join(".") || "form";
    if (!result[key]) result[key] = issue.message;
  });
  return result;
}

const NOTE_PATHS = ["/", "/planning", "/events", "/events/new"];
function revalidateNotePaths(): void {
  NOTE_PATHS.forEach((path) => revalidatePath(path));
}

export async function createCalendarNote(input: unknown): Promise<CalendarNoteActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Not authenticated." };

  const parsed = createCalendarNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  if (!canCreateCalendarNote(user.role, user.venueId, parsed.data.venueId)) {
    return { success: false, message: "You do not have permission to add a note for this venue." };
  }

  try {
    const supabase = await createSupabaseActionClient();
    const { data, error } = await supabase
      .from("venue_calendar_notes")
      .insert({
        venue_id: parsed.data.venueId,
        title: parsed.data.title,
        detail: normaliseOptionalText(parsed.data.detail ?? null),
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate ?? null,
        created_by: user.id,
      })
      .select("id,venue_id,updated_at")
      .single();

    if (error || !data) {
      console.error("createCalendarNote insert failed:", error);
      return { success: false, message: "Could not add the note. Please try again." };
    }

    recordAuditLogEntry({
      entity: "calendar_note",
      entityId: data.id,
      action: "calendar_note.created",
      actorId: user.id,
      meta: { venueId: parsed.data.venueId, startDate: parsed.data.startDate, endDate: parsed.data.endDate ?? null },
    }).catch((e) => console.error("calendar_note.created audit failed:", e));

    revalidateNotePaths();
    return { success: true, message: "Note added.", noteId: data.id, updatedAt: data.updated_at };
  } catch (error) {
    console.error("createCalendarNote error:", error);
    return { success: false, message: "Could not add the note. Please try again." };
  }
}

export async function updateCalendarNote(input: unknown): Promise<CalendarNoteActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Not authenticated." };

  const parsed = updateCalendarNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Check the highlighted fields.", fieldErrors: zodFieldErrors(parsed.error) };
  }

  try {
    const supabase = await createSupabaseActionClient();

    const { data: existing, error: loadError } = await supabase
      .from("venue_calendar_notes")
      .select("id,venue_id,deleted_at,updated_at")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (loadError) {
      console.error("updateCalendarNote load failed:", loadError);
      return { success: false, message: "Could not load the note. Please try again." };
    }
    if (!existing || existing.deleted_at) {
      return { success: false, message: "Note not found. It may already have been deleted." };
    }
    // Permission is checked against BOTH the current venue and any requested new venue.
    if (
      !canManageCalendarNote(user.role, user.venueId, existing.venue_id) ||
      !canCreateCalendarNote(user.role, user.venueId, parsed.data.venueId)
    ) {
      return { success: false, message: "You do not have permission to edit this note." };
    }

    const { data, error } = await supabase
      .from("venue_calendar_notes")
      .update({
        venue_id: parsed.data.venueId,
        title: parsed.data.title,
        detail: normaliseOptionalText(parsed.data.detail ?? null),
        start_date: parsed.data.startDate,
        end_date: parsed.data.endDate ?? null,
      })
      .eq("id", parsed.data.id)
      .is("deleted_at", null)
      .eq("updated_at", parsed.data.expectedUpdatedAt)
      .select("id,updated_at")
      .maybeSingle();

    if (error) {
      console.error("updateCalendarNote update failed:", error);
      return { success: false, message: "Could not update the note. Please try again." };
    }
    if (!data) {
      const { data: still } = await supabase
        .from("venue_calendar_notes")
        .select("id,deleted_at")
        .eq("id", parsed.data.id)
        .maybeSingle();
      if (!still || still.deleted_at) {
        return { success: false, message: "Note not found. It may already have been deleted." };
      }
      return { success: false, message: "This note changed since you opened it. Reopen it and try again." };
    }

    recordAuditLogEntry({
      entity: "calendar_note",
      entityId: parsed.data.id,
      action: "calendar_note.updated",
      actorId: user.id,
      meta: { venueId: parsed.data.venueId, startDate: parsed.data.startDate, endDate: parsed.data.endDate ?? null },
    }).catch((e) => console.error("calendar_note.updated audit failed:", e));

    revalidateNotePaths();
    return { success: true, message: "Note updated.", noteId: parsed.data.id, updatedAt: data.updated_at };
  } catch (error) {
    console.error("updateCalendarNote error:", error);
    return { success: false, message: "Could not update the note. Please try again." };
  }
}

export async function deleteCalendarNote(input: unknown): Promise<CalendarNoteActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "Not authenticated." };

  const parsed = deleteCalendarNoteSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid request." };

  try {
    const supabase = await createSupabaseActionClient();

    const { data: existing, error: loadError } = await supabase
      .from("venue_calendar_notes")
      .select("id,venue_id,deleted_at,updated_at")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (loadError) {
      console.error("deleteCalendarNote load failed:", loadError);
      return { success: false, message: "Could not load the note. Please try again." };
    }
    if (!existing || existing.deleted_at) {
      return { success: false, message: "Note not found. It may already have been deleted." };
    }
    if (!canManageCalendarNote(user.role, user.venueId, existing.venue_id)) {
      return { success: false, message: "You do not have permission to delete this note." };
    }

    const { data, error } = await supabase
      .from("venue_calendar_notes")
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq("id", parsed.data.id)
      .is("deleted_at", null)
      .eq("updated_at", parsed.data.expectedUpdatedAt)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("deleteCalendarNote update failed:", error);
      return { success: false, message: "Could not delete the note. Please try again." };
    }
    if (!data) {
      return { success: false, message: "This note changed since you opened it. Reopen it and try again." };
    }

    recordAuditLogEntry({
      entity: "calendar_note",
      entityId: parsed.data.id,
      action: "calendar_note.deleted",
      actorId: user.id,
      meta: { venueId: existing.venue_id },
    }).catch((e) => console.error("calendar_note.deleted audit failed:", e));

    revalidateNotePaths();
    return { success: true, message: "Note deleted." };
  } catch (error) {
    console.error("deleteCalendarNote error:", error);
    return { success: false, message: "Could not delete the note. Please try again." };
  }
}
