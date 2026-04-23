import { Resend } from "resend";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { formatSpacesLabel } from "@/lib/venue-spaces";
import { getTodayLondonIsoDate, formatInLondon } from "@/lib/datetime";

const RESEND_FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? "BaronsHub <noreply@auth.orangejelly.co.uk>";
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://baronshub.orangejelly.co.uk";

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];
type DebriefRow = Database["public"]["Tables"]["debriefs"]["Row"];

type EventContext = EventRow & {
  venue: { name: string | null } | null;
  creator: Pick<UserRow, "id" | "email" | "full_name"> | null;
  assignee: Pick<UserRow, "id" | "email" | "full_name"> | null;
  debrief: DebriefRow | null;
};

type EmailContent = {
  headline: string;
  intro: string;
  body?: string[];
  button?: { label: string; url: string };
  meta?: string[];
  footerNote?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmailTemplate({ headline, intro, body = [], button, meta, footerNote }: EmailContent): {
  html: string;
  text: string;
} {
  const safeHeadline = escapeHtml(headline);
  const safeIntro = escapeHtml(intro);
  const paragraphHtml = body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  const metaHtml = meta?.length
    ? `<div class="meta">${meta.map((line) => escapeHtml(line)).join("<br />")}</div>`
    : "";
  const buttonHtml = button
    ? `<p style="text-align: center">
            <a class="button" href="${escapeHtml(button.url)}">${escapeHtml(button.label)}</a>
          </p>`
    : "";
  const footerHtml = footerNote ? `<p>${escapeHtml(footerNote)}</p>` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeHeadline}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: "Geist", "Inter", "Helvetica Neue", Arial, sans-serif;
        background-color: #E7E0D4;
        color: #273640;
      }
      .wrapper {
        padding: 48px 16px;
      }
      .card {
        max-width: 600px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 24px;
        box-shadow: 0 24px 55px -28px rgba(15, 27, 58, 0.3);
        overflow: hidden;
      }
      .header {
        background: linear-gradient(135deg, #273640, #1b2530);
        color: #B49A67;
        padding: 40px 40px 32px;
        text-align: center;
      }
      .header h1 {
        margin: 0;
        font-family: "Playfair Display", "Georgia", serif;
        font-size: 28px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .header p {
        margin: 12px 0 0;
        font-size: 15px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .content {
        padding: 40px 40px 32px;
      }
      .content h2 {
        margin: 0 0 16px;
        font-size: 22px;
      }
      .content p {
        margin: 0 0 16px;
        line-height: 1.6;
        font-size: 15px;
      }
      .button {
        display: inline-block;
        margin: 24px 0;
        padding: 14px 32px;
        background-color: #273640;
        color: #ffffff;
        border-radius: 999px;
        text-decoration: none;
        font-weight: 600;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .button:hover {
        background-color: #1f2b33;
      }
      .meta {
        margin-top: 24px;
        padding: 16px 20px;
        border-radius: 16px;
        background: rgba(39, 54, 64, 0.06);
        font-size: 13px;
        line-height: 1.5;
      }
      .footer {
        padding: 0 40px 40px;
        font-size: 13px;
        color: #6E3C3D;
      }
      a.inline-link {
        color: #273640;
        font-weight: 600;
        text-decoration: underline dotted;
        text-decoration-thickness: 1px;
      }
      @media (max-width: 640px) {
        .card {
          border-radius: 20px;
        }
        .header,
        .content,
        .footer {
          padding-left: 24px;
          padding-right: 24px;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <h1>BaronsHub</h1>
          <p>Accelerating Barons Success Everyday</p>
        </div>
        <div class="content">
          <h2>${safeHeadline}</h2>
          <p>${safeIntro}</p>
          ${paragraphHtml}
          ${buttonHtml}
          ${metaHtml}
        </div>
        <div class="footer">
          © ${escapeHtml(APP_BASE_URL)} · Sent from the BaronsHub planning team.<br />
          Need help? Email <a href="mailto:peter@orangejelly.co.uk">peter@orangejelly.co.uk</a>.
          ${footerHtml}
        </div>
      </div>
    </div>
  </body>
</html>`;

  const textParts = [
    headline,
    "",
    intro,
    "",
    ...body,
    button ? `Action: ${button.label} -> ${button.url}` : "",
    ...(meta ?? []),
    footerNote ?? ""
  ].filter(Boolean);

  const text = textParts.join("\n");

  return { html, text };
}

function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return null;
  }
  return new Resend(key);
}

/**
 * Global kill-switch for all non-auth notification emails. When the env var
 * NOTIFICATIONS_DISABLED is set to "true", the nine business notifications
 * (event submitted, review decisions, debrief reminders, SLT digest, etc.)
 * log a "would have sent" line and return early. Auth emails
 * (sendInviteEmail, sendPasswordResetEmail) are intentionally excluded and
 * always attempt to send — users still need to sign in and reset passwords.
 *
 * To bring notifications back: remove NOTIFICATIONS_DISABLED (or set it to
 * anything other than "true") and redeploy / restart the dev server.
 */
function areNotificationsEnabled(): boolean {
  return process.env.NOTIFICATIONS_DISABLED !== "true";
}

function logNotificationSkipped(label: string, ...context: unknown[]): void {
  console.log(`[notifications disabled] skipped ${label}`, ...context);
}

async function fetchEventContext(eventId: string): Promise<EventContext | null> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      `
      *,
      venue:venues!events_venue_id_fkey(name),
      creator:users!events_created_by_fkey(id,full_name,email),
      assignee:users!events_assignee_id_fkey(id,full_name,email),
      debrief:debriefs(*)
    `
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not fetch event for notification: ${error.message}`);
  }

  return (data as EventContext) ?? null;
}

async function fetchUser(userId: string | null | undefined): Promise<Pick<UserRow, "email" | "full_name" | "id"> | null> {
  if (!userId) return null;
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not fetch user: ${error.message}`);
  }

  return data ?? null;
}

async function listUsersByRole(role: UserRow["role"]): Promise<Pick<UserRow, "id" | "email" | "full_name">[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("users")
    .select("id,email,full_name")
    .eq("role", role)
    .is("deactivated_at", null)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not list users: ${error.message}`);
  }

  return (data ?? []) as Pick<UserRow, "id" | "email" | "full_name">[];
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short"
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit"
});

function formatEventWindow(event: EventRow): string {
  const start = new Date(event.start_at);
  const end = new Date(event.end_at);
  return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
}

function eventLink(eventId: string): string {
  return `${APP_BASE_URL}/events/${eventId}`;
}

function debriefLink(eventId: string): string {
  return `${APP_BASE_URL}/debriefs/${eventId}`;
}

function assigneeQueueLink(): string {
  return `${APP_BASE_URL}/reviews`;
}

function plannerDashboardLink(): string {
  return `${APP_BASE_URL}/events`;
}

function buildGreeting(user: Pick<UserRow, "full_name"> | null | undefined, fallback = "Hi there") {
  if (user?.full_name) {
    return `Hi ${user.full_name},`;
  }
  return `${fallback},`;
}

export async function sendEventSubmittedEmail(eventId: string) {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendEventSubmittedEmail", { eventId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.assignee?.email) return;

    const { html, text } = renderEmailTemplate({
      headline: "New event waiting for review",
      intro: `${buildGreeting(event.assignee, "Hello")} ${event.creator?.full_name ?? "A venue manager"} just sent in "${event.title}".`,
      body: [
        "Take a look at the details, leave quick feedback, or mark it ready to go live.",
        "Head straight to your review queue to keep things moving."
      ],
      button: { label: "Open my review queue", url: assigneeQueueLink() },
      meta: [
        `Event: ${event.title}`,
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `When: ${formatEventWindow(event)}`,
        formatSpacesLabel(event.venue_space),
        `Assignee: ${event.assignee?.full_name ?? "Unassigned"}`
      ]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: event.assignee.email,
      subject: `New event ready for review: ${event.title}`,
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send submission email", error);
  }
}

export async function sendReviewDecisionEmail(eventId: string, decision: string) {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendReviewDecisionEmail", { eventId, decision });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.creator?.email) return;

    const { html, text } = renderEmailTemplate({
      headline: `Your event is now marked ${decision.replace(/_/g, " ")}`,
      intro: `${buildGreeting(event.creator)} "${event.title}" has moved to ${decision.replace(/_/g, " ")}.`,
      body: [
        "Review the notes and make any updates needed so we can keep momentum.",
        "Once everything looks good, push the latest version live."
      ],
      button: { label: "Open your event", url: eventLink(eventId) },
      meta: [
        `Event: ${event.title}`,
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `When: ${formatEventWindow(event)}`,
        `Status: ${decision.replace(/_/g, " ")}`
      ]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: event.creator.email,
      subject: `Update on your event: ${event.title}`,
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send decision email", error);
  }
}

export async function sendInviteEmail(email: string, inviteLink: string, fullName?: string | null) {
  const resend = getResendClient();
  if (!resend) {
    return false;
  }

  try {
    const greeting = fullName ? `Hi ${fullName},` : "Hi there,";
    const { html, text } = renderEmailTemplate({
      headline: "You've been invited to BaronsHub",
      intro: `${greeting} you've been invited to join the Barons BaronsHub planning platform.`,
      body: [
        "Use the button below to set your password and get started.",
        "This invite link is valid for 7 days. If you didn't expect this email, you can safely ignore it."
      ],
      button: { label: "Accept invite & set password", url: inviteLink },
      meta: [`Invite link: ${inviteLink}`]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: email,
      subject: "You've been invited to BaronsHub",
      html,
      text
    });
    return true;
  } catch (error) {
    console.warn("Failed to send invite email", error);
    return false;
  }
}

export async function sendPasswordResetEmail(email: string, resetLink: string) {
  const resend = getResendClient();
  if (!resend) {
    return false;
  }

  try {
    const { html, text } = renderEmailTemplate({
      headline: "Reset your BaronsHub password",
      intro: "Hi there — we received a request to reset your BaronsHub password.",
      body: [
        "Use the button below to choose a new password and get back to planning.",
        "If you didn’t request this, you can safely ignore this message."
      ],
      button: { label: "Reset my password", url: resetLink },
      meta: [`Reset link: ${resetLink}`]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: email,
      subject: "Reset your BaronsHub password",
      html,
      text
    });
    return true;
  } catch (error) {
    console.warn("Failed to send password reset email", error);
    return false;
  }
}

export async function sendDebriefReminderEmail(eventId: string) {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendDebriefReminderEmail", { eventId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event || event.debrief || !event.creator?.email) {
      return;
    }

    const { html, text } = renderEmailTemplate({
      headline: "Add your post-event debrief",
      intro: `${buildGreeting(event.creator)} we still need the debrief for "${event.title}".`,
      body: [
        "Share attendance, takings, and headline learnings so the planning team can track performance.",
        "It only takes a minute and helps us plan smarter promotions."
      ],
      button: { label: "Complete debrief", url: debriefLink(eventId) },
      meta: [
        `Event: ${event.title}`,
        `When: ${formatEventWindow(event)}`,
        formatSpacesLabel(event.venue_space)
      ]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: event.creator.email,
      subject: `Reminder: add debrief for ${event.title}`,
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send debrief reminder email", error);
  }
}

export async function sendUpcomingEventReminderEmail(eventId: string) {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendUpcomingEventReminderEmail", { eventId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.creator?.email) return;

    const { html, text } = renderEmailTemplate({
      headline: "Upcoming event check-in",
      intro: `${buildGreeting(event.creator)} "${event.title}" is coming up soon.`,
      body: [
        "Double-check staffing, stock, and any promo assets so the team is ready.",
        "If details have changed, update the draft so the team stays in the loop."
      ],
      button: { label: "Review event plan", url: eventLink(eventId) },
      meta: [
        `Event: ${event.title}`,
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `When: ${formatEventWindow(event)}`,
        formatSpacesLabel(event.venue_space)
      ]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: event.creator.email,
      subject: `Reminder: ${event.title} is coming up`,
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send upcoming event reminder", error);
  }
}

export async function sendNeedsRevisionsFollowUpEmail(eventId: string) {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendNeedsRevisionsFollowUpEmail", { eventId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event || event.status !== "needs_revisions" || !event.creator?.email) return;

    const { html, text } = renderEmailTemplate({
      headline: "Event still needs tweaks",
      intro: `${buildGreeting(event.creator)} the team is waiting on updates for "${event.title}".`,
      body: [
        "Address the feedback and resubmit so we can confirm timings and promotion.",
        "If you need help, reply to this email or reach out on Teams."
      ],
      button: { label: "Update event draft", url: eventLink(eventId) },
      meta: [
        `Event: ${event.title}`,
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `Assignee: ${event.assignee?.full_name ?? "Unassigned"}`,
        `Status: Needs revisions`
      ]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: event.creator.email,
      subject: `Follow-up needed: ${event.title}`,
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send needs revisions follow-up", error);
  }
}

export async function sendAssigneeReassignmentEmail(
  eventId: string,
  newAssigneeId: string | null,
  previousAssigneeId?: string | null
) {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendAssigneeReassignmentEmail", { eventId, newAssigneeId, previousAssigneeId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event) return;

    const recipients: Array<{ user: Pick<UserRow, "id" | "email" | "full_name">; isNew: boolean }> = [];

    const newAssignee = await fetchUser(newAssigneeId);
    if (newAssignee?.email) {
      recipients.push({ user: newAssignee, isNew: true });
    }

    const previousAssignee = await fetchUser(previousAssigneeId);
    if (previousAssignee?.email) {
      recipients.push({ user: previousAssignee, isNew: false });
    }

    const results = await Promise.allSettled(
      recipients.map(async ({ user, isNew }) => {
        const headline = isNew ? "New event assignment" : "Event reassignment";
        const intro = isNew
          ? `${buildGreeting(user, "Hi")} we’ve assigned "${event.title}" to you.`
          : `${buildGreeting(user, "Hi")} "${event.title}" has been reassigned to another teammate.`;

        const { html, text } = renderEmailTemplate({
          headline,
          intro,
          body: isNew
            ? [
                "Take a look when you have a moment and leave a clear decision or comments for the venue.",
                "Thanks for keeping the pipeline moving."
              ]
            : ["No action needed from you. Thanks for jumping on other requests."],
          button: { label: "View event", url: eventLink(eventId) },
          meta: [
            `Event: ${event.title}`,
            `Venue: ${event.venue?.name ?? "Unknown venue"}`,
            `When: ${formatEventWindow(event)}`,
            formatSpacesLabel(event.venue_space)
          ]
        });

        await resend.emails.send({
          from: RESEND_FROM_ADDRESS,
          to: user.email,
          subject: `${isNew ? "New event assignment" : "Event assignment updated"}: ${event.title}`,
          html,
          text
        });
      })
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn(`Failed to send reassignment email to recipient ${index}`, result.reason);
      }
    });
  } catch (error) {
    console.warn("Failed to send assignee reassignment email", error);
  }
}

export async function sendPostEventDigestEmail(eventId: string) {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendPostEventDigestEmail", { eventId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.debrief) return;

    const planners = await listUsersByRole("administrator");
    const recipients = planners.filter((user) => user.email);
    if (!recipients.length) return;

    const debrief = event.debrief;
    const body: string[] = [];

    if (debrief.attendance != null) {
      body.push(`Attendance reported at ${debrief.attendance}.`);
    }
    if (debrief.baseline_attendance != null) {
      body.push(`Baseline attendance for a normal day: ${debrief.baseline_attendance}.`);
    }
    if (debrief.wet_takings != null || debrief.food_takings != null) {
      const takingsParts = [];
      if (debrief.wet_takings != null) takingsParts.push(`Wet £${Number(debrief.wet_takings).toFixed(2)}`);
      if (debrief.food_takings != null) takingsParts.push(`Food £${Number(debrief.food_takings).toFixed(2)}`);
      body.push(`Takings: ${takingsParts.join(" · ")}.`);
    }
    if (debrief.promo_effectiveness != null) {
      body.push(`Promo effectiveness scored ${debrief.promo_effectiveness}/5.`);
    }
    if (debrief.baseline_wet_takings != null || debrief.baseline_food_takings != null) {
      const baselineParts = [];
      if (debrief.baseline_wet_takings != null) baselineParts.push(`Baseline wet £${Number(debrief.baseline_wet_takings).toFixed(2)}`);
      if (debrief.baseline_food_takings != null) baselineParts.push(`Baseline food £${Number(debrief.baseline_food_takings).toFixed(2)}`);
      body.push(`Baseline day takings: ${baselineParts.join(" · ")}.`);
    }
    if (debrief.sales_uplift_value != null) {
      const upliftPercent =
        typeof debrief.sales_uplift_percent === "number" ? ` (${Number(debrief.sales_uplift_percent).toFixed(2)}%)` : "";
      body.push(`Sales uplift from event: £${Number(debrief.sales_uplift_value).toFixed(2)}${upliftPercent}.`);
    }
    if (debrief.highlights) {
      body.push(`Highlights: ${debrief.highlights}`);
    }
    if (debrief.issues) {
      body.push(`Issues: ${debrief.issues}`);
    }
    if (debrief.guest_sentiment_notes) {
      body.push(`Guest sentiment: ${debrief.guest_sentiment_notes}`);
    }
    if (debrief.operational_notes) {
      body.push(`Operational notes: ${debrief.operational_notes}`);
    }
    if (debrief.next_time_actions) {
      body.push(`Next-time actions: ${debrief.next_time_actions}`);
    }
    if (debrief.would_book_again != null) {
      body.push(`Would book again: ${debrief.would_book_again ? "Yes" : "No"}.`);
    }

    const { html, text } = renderEmailTemplate({
      headline: `Post-event digest: ${event.title}`,
      intro: `Team, here’s the latest debrief for "${event.title}".`,
      body,
      button: { label: "Open event timeline", url: eventLink(eventId) },
      meta: [
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `When: ${formatEventWindow(event)}`,
        `Submitted by: ${event.creator?.full_name ?? "Unknown"}`
      ],
      footerNote: "You’re receiving this because you’re listed as an administrator in BaronsHub."
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: recipients.map((user) => user.email),
      subject: `Post-event digest: ${event.title}`,
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send post-event digest email", error);
  }
}

/**
 * Returns active SLT members' email addresses.
 * Admin-only RLS on slt_members means callers must use the admin client.
 */
async function getSltRecipients(): Promise<string[]> {
  const db = createSupabaseAdminClient();
   
  const { data, error } = await (db as any)
    .from("slt_members")
    .select("user_id, users:user_id(email, deactivated_at)");
  if (error || !data) {
    console.warn("Failed to load SLT recipients", error);
    return [];
  }
  return data
    .filter(
      (row: { users?: { email?: string | null; deactivated_at?: string | null } }) =>
        row.users?.email && !row.users?.deactivated_at
    )
    .map((row: { users?: { email?: string | null } }) => row.users!.email!) as string[];
}

/**
 * Sends a debrief digest to SLT members.
 *
 * Privacy: uses BCC so members don't see each other's addresses.
 * If SLT_FROM_ALIAS is set, sends one email with the alias in `to:` and
 * members in `bcc:`. Otherwise sends one email per recipient to avoid
 * leaking the list.
 *
 * Fire-and-audit pattern: failures are logged + audited but not thrown —
 * the debrief submission succeeds even if email delivery fails.
 */
export async function sendDebriefSubmittedToSltEmail(eventId: string): Promise<void> {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendDebriefSubmittedToSltEmail", { eventId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.debrief) return;

    const recipients = await getSltRecipients();
    if (!recipients.length) {
      console.warn("SLT recipient list is empty — no email sent for debrief", eventId);
      return;
    }

    const debrief = event.debrief;
    const body: string[] = [];
    if (debrief.attendance != null) body.push(`Attendance: ${debrief.attendance}.`);
    if (debrief.wet_takings != null || debrief.food_takings != null) {
      const parts: string[] = [];
      if (debrief.wet_takings != null) parts.push(`Wet £${Number(debrief.wet_takings).toFixed(2)}`);
      if (debrief.food_takings != null) parts.push(`Food £${Number(debrief.food_takings).toFixed(2)}`);
      body.push(`Takings: ${parts.join(" · ")}.`);
    }
     
    const d = debrief as any;
    if (typeof d.labour_hours === "number" && typeof d.labour_rate_gbp_at_submit === "number") {
      const cost = (d.labour_hours * d.labour_rate_gbp_at_submit).toFixed(2);
      body.push(`Labour: ${d.labour_hours}h at £${d.labour_rate_gbp_at_submit.toFixed(2)}/hr — £${cost}.`);
    }
    if (debrief.promo_effectiveness != null) {
      body.push(`Promo effectiveness scored ${debrief.promo_effectiveness}/5.`);
    }
    if (debrief.highlights) body.push(`Highlights: ${debrief.highlights}`);
    if (debrief.issues) body.push(`Issues: ${debrief.issues}`);

    const { html, text } = renderEmailTemplate({
      headline: `Debrief submitted: ${event.title}`,
      intro: `${event.creator?.full_name ?? "A venue manager"} has submitted the debrief for "${event.title}".`,
      body,
      button: { label: "View debrief", url: eventLink(eventId) },
      meta: [
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `When: ${formatEventWindow(event)}`
      ],
      footerNote: "You're receiving this because you're a member of the SLT distribution list in BaronsHub."
    });

    const subject = `Debrief submitted: ${event.title}`;
    const alias = process.env.SLT_FROM_ALIAS;

    if (alias) {
      // Single email: alias in `to`, members bcc'd. Members don't see each other.
      await resend.emails.send({
        from: RESEND_FROM_ADDRESS,
        to: [alias],
        bcc: recipients,
        subject,
        html,
        text
      });
    } else {
      // No alias — send one email per recipient so nobody sees the list.
      await Promise.all(
        recipients.map((to) =>
          resend.emails.send({
            from: RESEND_FROM_ADDRESS,
            to: [to],
            subject,
            html,
            text
          })
        )
      );
    }
  } catch (error) {
    console.warn("Failed to send SLT debrief email", error);
    // No throw — debrief submission is already authoritative.
  }
}

/**
 * Sends a twice-weekly digest email to all active users who have open planning tasks.
 *
 * Content:
 * 1. Open tasks grouped by planning item (with event title as context if linked)
 * 2. Upcoming events in the next 4 days (venue-scoped for users with venue_id)
 *
 * Idempotent per calendar day (London timezone) — duplicate runs on the same day are skipped.
 */
export async function sendWeeklyDigestEmail(): Promise<{ sent: number; failed: number; skippedAssignees: number }> {
  if (!areNotificationsEnabled()) {
    logNotificationSkipped("sendWeeklyDigestEmail");
    return { sent: 0, failed: 0, skippedAssignees: 0 };
  }
  const resend = getResendClient();
  if (!resend) return { sent: 0, failed: 0, skippedAssignees: 0 };

  const todayLondon = getTodayLondonIsoDate();
  const db = createSupabaseAdminClient();

  // Idempotency: skip if we already sent a digest for this date
  const { data: existing, error: idempotencyError } = await db
    .from("audit_log")
    .select("id")
    .eq("entity", "digest")
    .eq("entity_id", todayLondon)
    .eq("action", "digest.batch_sent")
    .limit(1);

  if (idempotencyError) {
    console.error("sendWeeklyDigestEmail: idempotency check failed", idempotencyError);
  }
  if (existing && existing.length > 0) {
    return { sent: 0, failed: 0, skippedAssignees: 0 };
  }

  // Parallel data fetch
  const nowIso = new Date().toISOString();
  const fourDaysFromNow = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

  const [tasksResult, eventsResult, usersResult] = await Promise.all([
    db
      .from("planning_tasks")
      .select("id, title, due_date, assignee_id, planning_item:planning_items!inner(id, title, event:events(id, title, venue_id))")
      .eq("status", "open")
      .lte("due_date", todayLondon)
      .not("assignee_id", "is", null),
    db
      .from("events")
      .select("id, title, start_at, end_at, venue_id, venue:venues!events_venue_id_fkey(name)")
      .gte("start_at", nowIso)
      .lt("start_at", fourDaysFromNow)
      .in("status", ["approved", "submitted"])
      .is("deleted_at", null)
      .order("start_at", { ascending: true }),
    db
      .from("users")
      .select("id, email, full_name, venue_id")
      .is("deactivated_at", null)
  ]);

  if (tasksResult.error) throw new Error(`Failed to fetch planning tasks: ${tasksResult.error.message}`);
  if (eventsResult.error) throw new Error(`Failed to fetch upcoming events: ${eventsResult.error.message}`);
  if (usersResult.error) throw new Error(`Failed to fetch users: ${usersResult.error.message}`);

  const tasks = tasksResult.data ?? [];
  const upcomingEvents = eventsResult.data ?? [];
  const users = usersResult.data ?? [];

  // Build user lookup
  type DigestUser = { email: string; fullName: string | null; venueId: string | null };
  const userMap = new Map<string, DigestUser>();
  for (const u of users) {
    userMap.set(u.id, { email: u.email, fullName: u.full_name, venueId: u.venue_id });
  }

  // Group tasks by assignee
  type TaskWithContext = typeof tasks[number];
  const tasksByAssignee = new Map<string, TaskWithContext[]>();
  let skippedAssignees = 0;

  for (const task of tasks) {
    const assigneeId = task.assignee_id as string;
    if (!userMap.has(assigneeId)) {
      skippedAssignees++;
      continue;
    }
    const existing = tasksByAssignee.get(assigneeId);
    if (existing) {
      existing.push(task);
    } else {
      tasksByAssignee.set(assigneeId, [task]);
    }
  }

  let sent = 0;
  let failed = 0;

  for (const [assigneeId, assigneeTasks] of tasksByAssignee) {
    try {
      const user = userMap.get(assigneeId)!;

      // Group tasks by planning item
      type PlanningGroup = {
        planningItemId: string;
        heading: string;
        tasks: { title: string; dueDate: string; overdue: boolean }[];
        earliestDue: string;
      };
      const groupMap = new Map<string, PlanningGroup>();

      for (const task of assigneeTasks) {
        const pi = task.planning_item as unknown as {
          id: string;
          title: string;
          event: { id: string; title: string; venue_id: string | null } | null;
        };
        const piId = pi.id;

        if (!groupMap.has(piId)) {
          let heading = escapeHtml(pi.title);
          if (pi.event) {
            heading += ` \u2014 for ${escapeHtml(pi.event.title)}`;
          }
          groupMap.set(piId, {
            planningItemId: piId,
            heading,
            tasks: [],
            earliestDue: task.due_date as string
          });
        }

        const group = groupMap.get(piId)!;
        const isOverdue = (task.due_date as string) < todayLondon;
        group.tasks.push({
          title: task.title,
          dueDate: task.due_date as string,
          overdue: isOverdue
        });
        if ((task.due_date as string) < group.earliestDue) {
          group.earliestDue = task.due_date as string;
        }
      }

      // Sort groups by earliest due date
      const sortedGroups = Array.from(groupMap.values()).sort(
        (a, b) => a.earliestDue.localeCompare(b.earliestDue)
      );

      // Sort tasks within each group: overdue first, then by due date
      for (const group of sortedGroups) {
        group.tasks.sort((a, b) => {
          if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
          return a.dueDate.localeCompare(b.dueDate);
        });
      }

      // Build email body lines with 50-task cap
      const body: string[] = [];
      let taskCount = 0;
      let totalTasks = 0;
      for (const group of sortedGroups) {
        totalTasks += group.tasks.length;
      }

      let capped = false;
      for (const group of sortedGroups) {
        if (capped) break;
        body.push(`\ud83d\udccb ${group.heading}`);
        for (const task of group.tasks) {
          if (taskCount >= 50) {
            capped = true;
            break;
          }
          const { date: formattedDate } = formatInLondon(task.dueDate + "T00:00:00Z");
          const marker = task.overdue ? "\u26a0\ufe0f " : "";
          body.push(`  \u2022 ${escapeHtml(task.title)} \u2014 due ${formattedDate}${marker ? ` ${marker}overdue` : ""}`);
          taskCount++;
        }
      }

      if (capped && totalTasks > 50) {
        body.push(`\u2026and ${totalTasks - 50} more \u2014 view in BaronsHub`);
      }

      // Filter upcoming events by venue scope
      const recipientEvents = upcomingEvents.filter((evt) => {
        if (!user.venueId) return true;
        return (evt as unknown as { venue_id: string | null }).venue_id === user.venueId;
      });

      if (recipientEvents.length > 0) {
        body.push("", "Coming up in the next 4 days:");
        for (const evt of recipientEvents) {
          const when = formatEventWindow(evt as unknown as EventRow);
          const venueName = (evt as unknown as { venue: { name: string } | null }).venue?.name ?? "Unknown venue";
          body.push(`  \u2022 ${escapeHtml(evt.title)} \u2014 ${escapeHtml(venueName)}, ${when}`);
        }
      }

      const { html, text } = renderEmailTemplate({
        headline: "Your weekly digest",
        intro: "Here\u2019s what needs your attention this week.",
        body,
        button: { label: "Open BaronsHub", url: plannerDashboardLink() },
        footerNote: "You\u2019re receiving this because you have open tasks in BaronsHub."
      });

      await resend.emails.send({
        from: RESEND_FROM_ADDRESS,
        to: [user.email],
        subject: `Your BaronsHub digest \u2014 ${totalTasks} open task${totalTasks === 1 ? "" : "s"}`,
        html,
        text
      });

      sent++;
    } catch (error) {
      console.error(`sendWeeklyDigestEmail: failed for assignee ${assigneeId}`, error);
      failed++;
    }
  }

  // Record idempotency audit entry
  try {
    await db.from("audit_log").insert({
      entity: "digest",
      entity_id: todayLondon,
      action: "digest.batch_sent",
      actor_id: null,
      meta: { sent, failed, skipped_assignees: skippedAssignees } as unknown as Database["public"]["Tables"]["audit_log"]["Row"]["meta"]
    });
  } catch (auditError) {
    console.error("sendWeeklyDigestEmail: failed to record audit entry", auditError);
  }

  return { sent, failed, skippedAssignees };
}
