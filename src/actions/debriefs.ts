"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { upsertDebrief } from "@/lib/debriefs";
import { debriefSchema } from "@/lib/validation";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { sendPostEventDigestEmail } from "@/lib/notifications";

type ActionResult = {
  success: boolean;
  message?: string;
};

export async function submitDebriefAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const parsed = debriefSchema.safeParse({
    eventId: formData.get("eventId"),
    attendance: formData.get("attendance") ?? undefined,
    wetTakings: formData.get("wetTakings") ?? undefined,
    foodTakings: formData.get("foodTakings") ?? undefined,
    promoEffectiveness: formData.get("promoEffectiveness") ?? undefined,
    highlights: formData.get("highlights") ?? undefined,
    issues: formData.get("issues") ?? undefined
  });

  if (!parsed.success) {
    return { success: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  try {
    const values = parsed.data;
    const supabase = await createSupabaseActionClient();

    await upsertDebrief({
      eventId: values.eventId,
      submittedBy: user.id,
      attendance: values.attendance ?? null,
      wetTakings: values.wetTakings ?? null,
      foodTakings: values.foodTakings ?? null,
      promoEffectiveness: values.promoEffectiveness ?? null,
      highlights: values.highlights ?? null,
      issues: values.issues ?? null
    });

    await (supabase.from("events") as any)
      .update({ status: "completed" })
      .eq("id", values.eventId);

    await sendPostEventDigestEmail(values.eventId);

    revalidatePath(`/events/${values.eventId}`);
    return { success: true, message: "Debrief saved." };
  } catch (error) {
    console.error(error);
    return { success: false, message: "Could not save the debrief." };
  }
}
