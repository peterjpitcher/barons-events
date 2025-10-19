import { Resend } from "resend";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return null;
  }
  return new Resend(key);
}

async function fetchEventContext(eventId: string) {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      `title, status, submitted_at, assigned_reviewer_id,
       creator:users!events_created_by_fkey(full_name,email),
       reviewer:users!events_assigned_reviewer_id_fkey(full_name,email)
      `
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not fetch event for notification: ${error.message}`);
  }

  return data as any;
}

export async function sendEventSubmittedEmail(eventId: string) {
  const resend = getResendClient();
  if (!resend) {
    return;
  }

  try {
    const event = (await fetchEventContext(eventId)) as any;
    if (!event) return;

    const reviewerEmail = event.reviewer?.email as string | undefined;
    if (!reviewerEmail) return;

    await resend.emails.send({
      from: "Barons Events <events@barons.example>",
      to: reviewerEmail,
      subject: `New event ready: ${event.title}`,
      text: `${event.title} has been submitted and is waiting for your review.`
    });
  } catch (error) {
    console.warn("Failed to send submission email", error);
  }
}

export async function sendReviewDecisionEmail(eventId: string, decision: string) {
  const resend = getResendClient();
  if (!resend) {
    return;
  }

  try {
    const event = (await fetchEventContext(eventId)) as any;
    if (!event) return;

    const creatorEmail = event.creator?.email as string | undefined;
    if (!creatorEmail) return;

    await resend.emails.send({
      from: "Barons Events <events@barons.example>",
      to: creatorEmail,
      subject: `Decision on ${event.title}`,
      text: `Your event is now marked as ${decision}.`
    });
  } catch (error) {
    console.warn("Failed to send decision email", error);
  }
}
