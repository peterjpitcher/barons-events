import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";

export type EventTypeRow = {
  id: string;
  label: string;
  created_at: string;
};

export async function listEventTypes(): Promise<EventTypeRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase.from("event_types").select("*").order("label");

  if (error) {
    throw new Error(`Could not load event types: ${error.message}`);
  }

  return data ?? [];
}

export async function createEventType(label: string) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("event_types").insert({ label });

  if (error) {
    throw new Error(`Could not create event type: ${error.message}`);
  }
}

export async function updateEventType(id: string, label: string) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("event_types").update({ label }).eq("id", id);

  if (error) {
    throw new Error(`Could not update event type: ${error.message}`);
  }
}

export async function deleteEventType(id: string) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("event_types").delete().eq("id", id);

  if (error) {
    throw new Error(`Could not delete event type: ${error.message}`);
  }
}
