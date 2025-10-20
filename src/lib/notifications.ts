import { Resend } from "resend";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

const RESEND_FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? "Barons Events <events@barons.example>";
const APP_BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://events.barons.example";

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
          <h1>EventHub</h1>
          <p>A Barons Innovation</p>
        </div>
        <div class="content">
          <h2>${safeHeadline}</h2>
          <p>${safeIntro}</p>
          ${paragraphHtml}
          ${buttonHtml}
          ${metaHtml}
        </div>
        <div class="footer">
          © ${escapeHtml(APP_BASE_URL)} · Sent from the EventHub planning team.<br />
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

async function fetchEventContext(eventId: string): Promise<EventContext | null> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      `
      *,
      venue:venues(name),
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
        `Space: ${event.venue_space}`,
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
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.creator?.email) return;

    const { html, text } = renderEmailTemplate({
      headline: `Your event is now marked ${decision.replace("_", " ")}`,
      intro: `${buildGreeting(event.creator)} "${event.title}" has moved to ${decision.replace("_", " ")}.`,
      body: [
        "Review the notes and make any updates needed so we can keep momentum.",
        "Once everything looks good, push the latest version live."
      ],
      button: { label: "Open your event", url: eventLink(eventId) },
      meta: [
        `Event: ${event.title}`,
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `When: ${formatEventWindow(event)}`,
        `Status: ${decision.replace("_", " ")}`
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

export async function sendPasswordResetEmail(email: string, resetLink: string) {
  const resend = getResendClient();
  if (!resend) {
    return false;
  }

  try {
    const { html, text } = renderEmailTemplate({
      headline: "Reset your EventHub password",
      intro: "Hi there — we received a request to reset your EventHub password.",
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
      subject: "Reset your EventHub password",
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
        `Space: ${event.venue_space}`
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
        "If details have changed, update the draft so reviewers stay in the loop."
      ],
      button: { label: "Review event plan", url: eventLink(eventId) },
      meta: [
        `Event: ${event.title}`,
        `Venue: ${event.venue?.name ?? "Unknown venue"}`,
        `When: ${formatEventWindow(event)}`,
        `Space: ${event.venue_space}`
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
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event || event.status !== "needs_revisions" || !event.creator?.email) return;

    const { html, text } = renderEmailTemplate({
      headline: "Event still needs tweaks",
      intro: `${buildGreeting(event.creator)} reviewers are waiting on updates for "${event.title}".`,
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

    await Promise.all(
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
            `Space: ${event.venue_space}`
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
  } catch (error) {
    console.warn("Failed to send assignee reassignment email", error);
  }
}

export async function sendPostEventDigestEmail(eventId: string) {
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.debrief) return;

    const planners = await listUsersByRole("central_planner");
    const recipients = planners.filter((user) => user.email);
    if (!recipients.length) return;

    const debrief = event.debrief;
    const body: string[] = [];

    if (debrief.attendance != null) {
      body.push(`Attendance reported at ${debrief.attendance}.`);
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
    if (debrief.highlights) {
      body.push(`Highlights: ${debrief.highlights}`);
    }
    if (debrief.issues) {
      body.push(`Issues: ${debrief.issues}`);
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
      footerNote: "You’re receiving this because you’re listed as a planner or executive in EventHub."
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

export async function sendWeeklyPipelineSummaryEmail() {
  const resend = getResendClient();
  if (!resend) return;

  try {
    const planners = await listUsersByRole("central_planner");
    if (!planners.length) return;

    const supabase = await createSupabaseReadonlyClient();
    const statuses = ["submitted", "needs_revisions", "approved"];

    const summary: Record<string, number> = {};
    await Promise.all(
      statuses.map(async (status) => {
        const { count } = await supabase
          .from("events")
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        summary[status] = count ?? 0;
      })
    );

    const { data: eventsWithDebriefs, error: missingError } = await supabase
      .from("events")
      .select("id, debrief:debriefs(id)")
      .in("status", ["approved", "completed"]);

    if (missingError) {
      throw new Error(`Could not fetch debrief status: ${missingError.message}`);
    }

    const missingDebriefs = (eventsWithDebriefs ?? []).filter((record) => !record.debrief);

    const { data: upcomingEvents, error: upcomingError } = await supabase
      .from("events")
      .select("id,title,start_at,end_at,venue_space, venue:venues(name)")
      .gte("start_at", new Date().toISOString())
      .order("start_at", { ascending: true })
      .limit(5);

    if (upcomingError) {
      throw new Error(`Could not fetch upcoming events: ${upcomingError.message}`);
    }

    const body: string[] = [
      `Submitted waiting review: ${summary.submitted ?? 0}`,
      `Needs revisions: ${summary.needs_revisions ?? 0}`,
      `Approved (pending comms): ${summary.approved ?? 0}`,
      `Events missing debrief: ${missingDebriefs?.length ?? 0}`
    ];

    if (upcomingEvents?.length) {
      body.push(
        "",
        "Next confirmed events:",
        ...upcomingEvents.map((event) => {
          const when = formatEventWindow(event as unknown as EventRow);
          const venue = (event as any).venue?.name ?? "Unknown venue";
          return `• ${event.title} (${venue}, ${when})`;
        })
      );
    }

    const { html, text } = renderEmailTemplate({
      headline: "Weekly pipeline roundup",
      intro: "Here’s the latest snapshot of the events pipeline so you’re ready for the week ahead.",
      body,
      button: { label: "Open planning board", url: plannerDashboardLink() },
      meta: [`Generated: ${new Date().toLocaleString("en-GB")}`],
      footerNote: "You’re receiving this because you’re a central planner in EventHub."
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: planners.map((user) => user.email),
      subject: "Weekly EventHub pipeline roundup",
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send weekly pipeline summary email", error);
  }
}
