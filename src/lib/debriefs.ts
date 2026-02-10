import { createSupabaseActionClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type DebriefRow = Database["public"]["Tables"]["debriefs"]["Row"];

export interface DebriefInput {
  eventId: string;
  submittedBy: string;
  attendance?: number | null;
  baselineAttendance?: number | null;
  wetTakings?: number | null;
  foodTakings?: number | null;
  baselineWetTakings?: number | null;
  baselineFoodTakings?: number | null;
  promoEffectiveness?: number | null;
  highlights?: string | null;
  issues?: string | null;
  guestSentimentNotes?: string | null;
  operationalNotes?: string | null;
  wouldBookAgain?: boolean | null;
  nextTimeActions?: string | null;
}

export async function upsertDebrief(input: DebriefInput): Promise<DebriefRow> {
  const supabase = await createSupabaseActionClient();

  const { data, error } = await supabase
    .from("debriefs")
    .upsert(
      {
        event_id: input.eventId,
        attendance: input.attendance ?? null,
        baseline_attendance: input.baselineAttendance ?? null,
        wet_takings: input.wetTakings ?? null,
        food_takings: input.foodTakings ?? null,
        baseline_wet_takings: input.baselineWetTakings ?? null,
        baseline_food_takings: input.baselineFoodTakings ?? null,
        promo_effectiveness: input.promoEffectiveness ?? null,
        highlights: input.highlights ?? null,
        issues: input.issues ?? null,
        guest_sentiment_notes: input.guestSentimentNotes ?? null,
        operational_notes: input.operationalNotes ?? null,
        would_book_again: input.wouldBookAgain ?? null,
        next_time_actions: input.nextTimeActions ?? null,
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
