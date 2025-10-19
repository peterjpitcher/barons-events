import { createSupabaseActionClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type DebriefRow = Database["public"]["Tables"]["debriefs"]["Row"];

export interface DebriefInput {
  eventId: string;
  submittedBy: string;
  attendance?: number | null;
  wetTakings?: number | null;
  foodTakings?: number | null;
  promoEffectiveness?: number | null;
  highlights?: string | null;
  issues?: string | null;
}

export async function upsertDebrief(input: DebriefInput): Promise<DebriefRow> {
  const supabase = await createSupabaseActionClient();

  const { data, error } = await supabase
    .from("debriefs")
    .upsert(
      {
        event_id: input.eventId,
        attendance: input.attendance ?? null,
        wet_takings: input.wetTakings ?? null,
        food_takings: input.foodTakings ?? null,
        promo_effectiveness: input.promoEffectiveness ?? null,
        highlights: input.highlights ?? null,
        issues: input.issues ?? null,
        submitted_by: input.submittedBy
      },
      { onConflict: "event_id" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Could not save debrief: ${error.message}`);
  }

  return data;
}
