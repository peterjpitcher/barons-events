import { Resend } from "resend";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import { formatSpacesLabel } from "@/lib/venue-spaces";
import { getTodayLondonIsoDate, formatInLondon } from "@/lib/datetime";
import { addDays } from "@/lib/planning/utils";
import { markPastEventOpenTodosNotRequired } from "@/lib/planning/sop";
import { normaliseTodoDigestFrequency, shouldSendTodoDigestToday } from "@/lib/communication-preferences";
import { resolveCentralEventsLeadRecipients } from "@/lib/central-events-lead";
import {
  buildMonthlySalesReportAttachments,
  renderMonthlySalesReportEmail,
  type SalesReport,
} from "@/lib/monthly-sales-report";
import {
  planNewEventNotifications,
  type NewEventTransition,
  type NotificationPerson,
} from "@/lib/notifications/plan-new-event";

const RESEND_FROM_ADDRESS = process.env.RESEND_FROM_EMAIL ?? "BaronsHub 1.1 <noreply@auth.orangejelly.co.uk>";
const BOOKING_RESEND_FROM_ADDRESS =
  process.env.BOOKING_RESEND_FROM_EMAIL ?? "Barons Pub Company <noreply@auth.orangejelly.co.uk>";
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://baronshub.orangejelly.co.uk";
const WEEKLY_UPDATE_TODO_EMAIL_LIMIT = 10;

type EventRow = Database["public"]["Tables"]["events"]["Row"];
type UserRow = Database["public"]["Tables"]["users"]["Row"];
type DebriefRow = Database["public"]["Tables"]["debriefs"]["Row"];

/**
 * The smallest event shape the new-event email builders need. Both
 * EventContext and AnnouncementEventContext widen it, so a builder can be
 * called with either.
 */
type NewEventEmailContext = EventRow & {
  venue: { name: string | null } | null;
  creator: Pick<UserRow, "id" | "email" | "full_name"> | null;
  assignee: Pick<UserRow, "id" | "email" | "full_name"> | null;
};

type EventContext = NewEventEmailContext & {
  debrief: DebriefRow | null;
};

type AnnouncementEventContext = NewEventEmailContext & {
  event_venues?: Array<{
    venue_id: string | null;
    venue: { name: string | null } | null;
  }> | null;
};

type ProposalEventContext = EventRow & {
  venue: { name: string | null } | null;
  creator: Pick<UserRow, "id" | "email" | "full_name"> | null;
  event_venues?: Array<{
    venue_id: string | null;
    venue: { name: string | null } | null;
  }> | null;
};

type EmailContent = {
  headline: string;
  intro: string;
  body?: string[];
  button?: { label: string; url: string };
  meta?: string[];
  footerNote?: string;
};

type WeeklyUpdateEmailItem = {
  title: string;
  detail: string;
};

type WeeklyUpdateEmailContent = {
  recipientName: string | null;
  approvedEvents: WeeklyUpdateEmailItem[];
  todoItems: WeeklyUpdateEmailItem[];
  todoOverflowCount: number;
  debriefs: WeeklyUpdateEmailItem[];
  appUrl: string;
};

type CustomerBookingEmailContent = {
  headline: string;
  intro: string;
  body?: string[];
  details?: Array<{ label: string; value: string | number | null | undefined }>;
  afterDetails?: string[];
  signoff?: string[];
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
          <h1>BaronsHub 1.1</h1>
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
          © ${escapeHtml(APP_BASE_URL)} · Sent from the BaronsHub 1.1 planning team.<br />
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

function renderWeeklyUpdateEmail({
  recipientName,
  approvedEvents,
  todoItems,
  todoOverflowCount,
  debriefs,
  appUrl
}: WeeklyUpdateEmailContent): { html: string; text: string } {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi there,";
  const todoCount = todoItems.length + todoOverflowCount;
  const todoStatHint = todoCount === 0
    ? "All clear"
    : todoOverflowCount > 0
      ? `${todoItems.length} shown in email`
      : `${todoItems.length} listed`;

  function renderRows(items: WeeklyUpdateEmailItem[], emptyText: string): string {
    if (items.length === 0) {
      return `<div class="empty">${escapeHtml(emptyText)}</div>`;
    }

    return items
      .map(
        (item) => `
          <div class="item">
            <div class="item-title">${escapeHtml(item.title)}</div>
            <div class="item-detail">${escapeHtml(item.detail)}</div>
          </div>`
      )
      .join("\n");
  }

  const overflowHtml = todoOverflowCount > 0
    ? `<div class="item muted-item">...and ${todoOverflowCount} more to-dos in BaronsHub.</div>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Weekly BaronsHub Update</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
        background: #ede7dc;
        color: #24343d;
      }
      .wrapper {
        padding: 32px 14px;
      }
      .card {
        max-width: 680px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #d8d0c4;
        border-radius: 18px;
        overflow: hidden;
      }
      .header {
        background: #23343e;
        color: #ffffff;
        padding: 28px 32px;
      }
      .eyebrow {
        margin: 0 0 10px;
        color: #d5aa00;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 30px;
        line-height: 1.2;
        font-weight: 700;
      }
      .intro {
        margin: 12px 0 0;
        color: #dfe6e6;
        font-size: 15px;
        line-height: 1.5;
      }
      .content {
        padding: 28px 32px 32px;
      }
      .summary {
        display: table;
        width: 100%;
        border-spacing: 0;
        margin: 0 0 24px;
      }
      .summary-cell {
        display: table-cell;
        width: 33.333%;
        padding: 0 8px 0 0;
      }
      .summary-box {
        border: 1px solid #e3ddd2;
        border-radius: 12px;
        padding: 14px;
        background: #f7f3ec;
      }
      .summary-number {
        display: block;
        font-size: 24px;
        line-height: 1;
        font-weight: 800;
        color: #23343e;
      }
      .summary-label {
        display: block;
        margin-top: 6px;
        color: #6c756f;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .summary-hint {
        display: block;
        margin-top: 5px;
        color: #8a8174;
        font-size: 11px;
        line-height: 1.2;
      }
      .section {
        margin-top: 22px;
        border-top: 1px solid #e5ded4;
        padding-top: 20px;
      }
      .section:first-of-type {
        margin-top: 0;
      }
      .section-heading {
        margin: 0 0 12px;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #23343e;
      }
      .count-pill {
        display: inline-block;
        margin-left: 8px;
        padding: 3px 8px;
        border-radius: 999px;
        background: #efe9de;
        color: #49545a;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: none;
      }
      .item,
      .empty {
        border: 1px solid #e5ded4;
        border-radius: 10px;
        padding: 12px 14px;
        margin: 8px 0;
        background: #fffdf9;
      }
      .item-title {
        font-size: 14px;
        line-height: 1.35;
        font-weight: 800;
        color: #24343d;
      }
      .item-detail,
      .empty,
      .muted-item {
        color: #69736f;
        font-size: 13px;
        line-height: 1.45;
      }
      .item-detail {
        margin-top: 4px;
      }
      .empty {
        background: #f7f3ec;
      }
      .button-wrap {
        text-align: center;
        margin: 28px 0 4px;
      }
      .button {
        display: inline-block;
        padding: 13px 22px;
        border-radius: 9px;
        background: #23343e;
        color: #ffffff;
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-decoration: none;
        text-transform: uppercase;
      }
      .footer {
        max-width: 680px;
        margin: 14px auto 0;
        color: #766f64;
        font-size: 12px;
        line-height: 1.5;
        text-align: center;
      }
      @media (max-width: 640px) {
        .wrapper {
          padding: 20px 10px;
        }
        .header,
        .content {
          padding-left: 20px;
          padding-right: 20px;
        }
        .summary,
        .summary-cell {
          display: block;
          width: 100%;
        }
        .summary-cell {
          padding: 0 0 8px;
        }
        h1 {
          font-size: 26px;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <p class="eyebrow">BaronsHub weekly update</p>
          <h1>Weekly BaronsHub update</h1>
          <p class="intro">${escapeHtml(greeting)} here is your weekly BaronsHub update.</p>
        </div>
        <div class="content">
          <div class="summary">
            <div class="summary-cell">
              <div class="summary-box">
                <span class="summary-number">${approvedEvents.length}</span>
                <span class="summary-label">Recently approved</span>
              </div>
            </div>
            <div class="summary-cell">
              <div class="summary-box">
                <span class="summary-number">${todoCount}</span>
                <span class="summary-label">Total SOP items</span>
                <span class="summary-hint">${escapeHtml(todoStatHint)}</span>
              </div>
            </div>
            <div class="summary-cell">
              <div class="summary-box">
                <span class="summary-number">${debriefs.length}</span>
                <span class="summary-label">Debriefs</span>
              </div>
            </div>
          </div>

          <div class="section">
            <h2 class="section-heading">Recently approved events <span class="count-pill">last 7 days</span></h2>
            ${renderRows(approvedEvents, "No newly approved events for your scope.")}
          </div>

          <div class="section">
            <h2 class="section-heading">Your SOP to-dos <span class="count-pill">due now or next 14 days</span></h2>
            ${renderRows(todoItems, "No open to-dos. Nice work, you are all caught up.")}
            ${overflowHtml}
          </div>

          <div class="section">
            <h2 class="section-heading">Debriefed events <span class="count-pill">last 7 days</span></h2>
            ${renderRows(debriefs, "No debriefs submitted for your scope.")}
          </div>

          <div class="button-wrap">
            <a class="button" href="${escapeHtml(appUrl)}">Open BaronsHub</a>
          </div>
        </div>
      </div>
      <div class="footer">
        Your helpful weekly update from BaronsHub sent every Tuesday<br />
        ${escapeHtml(APP_BASE_URL)} · Sent from the BaronsHub 1.1 planning team.
      </div>
    </div>
  </body>
</html>`;

  const textLines = [
    "Weekly BaronsHub update",
    "",
    `${greeting} here is your weekly BaronsHub update.`,
    "",
    `Recently approved events in the last 7 days (${approvedEvents.length}):`,
    ...(approvedEvents.length
      ? approvedEvents.map((item) => `  - ${item.title} — ${item.detail}`)
      : ["  No newly approved events for your scope."]),
    "",
    `Your SOP to-dos due now or in the next 14 days (${todoCount}):`,
    ...(todoItems.length
      ? todoItems.map((item) => `  - ${item.title} — ${item.detail}`)
      : ["  No open to-dos. Nice work, you are all caught up."]),
    ...(todoOverflowCount > 0 ? [`  ...and ${todoOverflowCount} more to-dos in BaronsHub.`] : []),
    "",
    `Debriefed events in the last 7 days (${debriefs.length}):`,
    ...(debriefs.length
      ? debriefs.map((item) => `  - ${item.title} — ${item.detail}`)
      : ["  No debriefs submitted for your scope."]),
    "",
    `Open BaronsHub: ${appUrl}`,
    "",
    "Your helpful weekly update from BaronsHub sent every Tuesday"
  ];

  return { html, text: textLines.join("\n") };
}

function renderCustomerBookingEmailTemplate({
  headline,
  intro,
  body = [],
  details = [],
  afterDetails = [],
  signoff = ["See you soon,", "Barons Pub Company"],
}: CustomerBookingEmailContent): {
  html: string;
  text: string;
} {
  const safeHeadline = escapeHtml(headline);
  const safeIntro = escapeHtml(intro);
  const paragraphHtml = body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  const detailRows = details
    .filter((detail) => detail.value !== null && detail.value !== undefined && `${detail.value}`.trim() !== "")
    .map(
      (detail) => `<tr>
              <th>${escapeHtml(detail.label)}</th>
              <td>${escapeHtml(String(detail.value))}</td>
            </tr>`,
    )
    .join("\n");
  const detailsHtml = detailRows
    ? `<table class="details" role="presentation" cellspacing="0" cellpadding="0">
            <tbody>${detailRows}</tbody>
          </table>`
    : "";
  const afterDetailsHtml = afterDetails.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n");
  const signoffHtml = signoff.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");

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
        font-family: Arial, Helvetica, sans-serif;
        background-color: #f4f1eb;
        color: #273640;
      }
      .wrapper {
        padding: 32px 16px;
      }
      .card {
        max-width: 600px;
        margin: 0 auto;
        background-color: #ffffff;
        border-radius: 12px;
        overflow: hidden;
      }
      .header {
        background-color: #273640;
        color: #ffffff;
        padding: 28px 32px;
      }
      .header h1 {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 26px;
        line-height: 1.2;
      }
      .header p {
        margin: 8px 0 0;
        color: #d9aa6d;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .content {
        padding: 32px;
      }
      .content h2 {
        margin: 0 0 18px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 24px;
        line-height: 1.25;
      }
      .content p {
        margin: 0 0 16px;
        line-height: 1.6;
        font-size: 15px;
      }
      .details {
        width: 100%;
        margin: 24px 0;
        border: 1px solid #d4d9dd;
        border-radius: 10px;
        border-collapse: separate;
        border-spacing: 0;
        background-color: #f8f4ee;
        overflow: hidden;
      }
      .details th,
      .details td {
        padding: 12px 16px;
        border-bottom: 1px solid #d4d9dd;
        font-size: 14px;
        line-height: 1.4;
        vertical-align: top;
      }
      .details tr:last-child th,
      .details tr:last-child td {
        border-bottom: 0;
      }
      .details th {
        width: 34%;
        color: #637c8c;
        font-weight: 600;
        text-align: left;
      }
      .details td {
        color: #273640;
        font-weight: 700;
        text-align: right;
      }
      .signoff {
        margin-top: 24px;
      }
      .signoff p {
        margin-bottom: 4px;
      }
      @media (max-width: 640px) {
        .wrapper {
          padding: 0;
        }
        .card {
          border-radius: 0;
        }
        .header,
        .content {
          padding-left: 24px;
          padding-right: 24px;
        }
        .details th,
        .details td {
          display: block;
          width: auto;
          text-align: left;
          border-bottom: 0;
          padding-bottom: 4px;
        }
        .details td {
          padding-top: 0;
          padding-bottom: 12px;
          border-bottom: 1px solid #d4d9dd;
        }
        .details tr:last-child td {
          border-bottom: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <h1>Barons Pub Company</h1>
          <p>Event booking</p>
        </div>
        <div class="content">
          <h2>${safeHeadline}</h2>
          <p>${safeIntro}</p>
          ${paragraphHtml}
          ${detailsHtml}
          ${afterDetailsHtml}
          <div class="signoff">
            ${signoffHtml}
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const textDetails = details
    .filter((detail) => detail.value !== null && detail.value !== undefined && `${detail.value}`.trim() !== "")
    .map((detail) => `${detail.label}: ${detail.value}`);
  const textParts = [
    headline,
    "",
    intro,
    "",
    ...body,
    "",
    textDetails.length ? "Booking details:" : "",
    ...textDetails,
    "",
    ...afterDetails,
    "",
    ...signoff,
  ].filter(Boolean);

  return { html, text: textParts.join("\n") };
}

function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return null;
  }
  return new Resend(key);
}

/**
 * Booking emails are customer communications and may send whenever Resend is
 * configured. Wider BaronsHub 1.1 operational emails are opt-in so enabling Resend
 * for booking confirmations does not start staff workflow emails.
 *
 * Auth emails (sendInviteEmail, sendPasswordResetEmail) are intentionally
 * separate and always attempt to send because users need account access.
 */
function areBookingEmailsEnabled(): boolean {
  return process.env.BOOKING_EMAILS_DISABLED !== "true";
}

function areOperationalEmailsEnabled(): boolean {
  return (
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED === "true" &&
    process.env.NOTIFICATIONS_DISABLED !== "true"
  );
}

function logNotificationSkipped(label: string, ...context: unknown[]): void {
  console.log(`[notifications disabled] skipped ${label}`, ...context);
}

function formatPaymentAmount(amountPence: number, currency = "gbp"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
}

async function fetchBookingNotificationContext(bookingId: string): Promise<{
  booking: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    ticket_count: number;
  };
  event: { title: string; start_at: string; venue: { name: string | null } | null };
} | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select(`
      id, first_name, last_name, email, ticket_count,
      events (
        title, start_at,
        venue:venues!events_venue_id_fkey(name)
      )
    `)
    .eq("id", bookingId)
    .maybeSingle();

  if (error || !data) {
    console.error("fetchBookingNotificationContext failed", bookingId, error);
    return null;
  }

  const row = data as Record<string, unknown>;
  const eventRaw = Array.isArray(row.events)
    ? row.events[0] as Record<string, unknown> | undefined
    : row.events as Record<string, unknown> | undefined;
  if (!eventRaw) return null;
  const venueRaw = Array.isArray(eventRaw.venue)
    ? eventRaw.venue[0] as Record<string, unknown> | undefined
    : eventRaw.venue as Record<string, unknown> | undefined;

  return {
    booking: {
      id: row.id as string,
      first_name: row.first_name as string,
      last_name: (row.last_name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      ticket_count: row.ticket_count as number,
    },
    event: {
      title: eventRaw.title as string,
      start_at: eventRaw.start_at as string,
      venue: venueRaw ? { name: (venueRaw.name as string | null) ?? null } : null,
    },
  };
}

export async function sendBookingPaymentConfirmationEmail(params: {
  bookingId: string;
  amountPence: number;
  currency?: string;
}): Promise<boolean> {
  if (!areBookingEmailsEnabled()) {
    logNotificationSkipped("booking-payment-confirmation", params.bookingId);
    return true;
  }

  const context = await fetchBookingNotificationContext(params.bookingId);
  if (!context?.booking.email) return false;

  const resend = getResendClient();
  if (!resend) {
    console.warn("sendBookingPaymentConfirmationEmail skipped: RESEND_API_KEY not configured");
    return false;
  }

  const { date, time } = formatInLondon(context.event.start_at);
  const venueName = context.event.venue?.name ?? "the venue";
  const amount = formatPaymentAmount(params.amountPence, params.currency);
  const content = renderCustomerBookingEmailTemplate({
    headline: "Your booking is confirmed",
    intro: `Hi ${context.booking.first_name},`,
    body: ["Thanks for booking. Your payment has been received and your place is confirmed."],
    details: [
      { label: "Event", value: context.event.title },
      { label: "Venue", value: venueName },
      { label: "Date/time", value: `${date} at ${time}` },
      {
        label: "Tickets",
        value: `${context.booking.ticket_count} ticket${context.booking.ticket_count === 1 ? "" : "s"}`,
      },
      { label: "Amount paid", value: amount },
      { label: "Booking reference", value: context.booking.id.slice(0, 8) },
    ],
    afterDetails: [
      "Please keep this email handy and bring it with you on the day. If you are viewing your confirmation on mobile, we recommend taking a screenshot of your booking details.",
      "If you have any questions about your booking, please contact the venue directly.",
    ],
  });

  try {
    await resend.emails.send({
      from: BOOKING_RESEND_FROM_ADDRESS,
      to: context.booking.email,
      subject: "Your booking is confirmed",
      html: content.html,
      text: content.text,
    });
    return true;
  } catch (error) {
    console.error("sendBookingPaymentConfirmationEmail failed", error);
    return false;
  }
}

export async function sendBookingRefundEmail(params: {
  bookingId: string;
  amountPence: number;
  currency?: string;
  isFullRefund: boolean;
}): Promise<boolean> {
  if (!areBookingEmailsEnabled()) {
    logNotificationSkipped("booking-refund", params.bookingId);
    return true;
  }

  const context = await fetchBookingNotificationContext(params.bookingId);
  if (!context?.booking.email) return false;

  const resend = getResendClient();
  if (!resend) {
    console.warn("sendBookingRefundEmail skipped: RESEND_API_KEY not configured");
    return false;
  }

  const amount = formatPaymentAmount(params.amountPence, params.currency);
  const { date, time } = formatInLondon(context.event.start_at);
  const venueName = context.event.venue?.name ?? "the venue";
  const content = renderCustomerBookingEmailTemplate({
    headline: params.isFullRefund ? "Your booking has been refunded" : "A refund has been issued",
    intro: `Hi ${context.booking.first_name},`,
    body: [`${amount} has been refunded for your booking.`],
    details: [
      { label: "Event", value: context.event.title },
      { label: "Venue", value: venueName },
      { label: "Date/time", value: `${date} at ${time}` },
      { label: "Refund amount", value: amount },
      { label: "Booking reference", value: context.booking.id.slice(0, 8) },
    ],
    afterDetails: [
      params.isFullRefund
        ? "Your booking has been cancelled. The refund will return to your original payment method."
        : "Your booking remains active. The refund will return to your original payment method.",
      "Refund timings depend on the card issuer and are usually a few working days.",
    ],
  });

  try {
    await resend.emails.send({
      from: BOOKING_RESEND_FROM_ADDRESS,
      to: context.booking.email,
      subject: params.isFullRefund
        ? `Refund issued: ${context.event.title}`
        : `Partial refund issued: ${context.event.title}`,
      html: content.html,
      text: content.text,
    });
    return true;
  } catch (error) {
    console.error("sendBookingRefundEmail failed", error);
    return false;
  }
}

/**
 * Notify a customer that their paid booking has been moved to a new event/date.
 * Used by the booking-transfer flow. No money moves — the existing payment is
 * carried over — so the copy must make clear there is nothing more to pay.
 * Returns false when the booking has no email (caller surfaces "manual contact
 * required") or when sending fails.
 */
export async function sendBookingTransferEmail(params: {
  newBookingId: string;
  previousEventId: string;
  /** True for paid bookings (payment carried over); false for free/RSVP moves. */
  isPaid?: boolean;
}): Promise<boolean> {
  const isPaid = params.isPaid ?? true;
  if (!areBookingEmailsEnabled()) {
    logNotificationSkipped("booking-transfer", params.newBookingId);
    return true;
  }

  const context = await fetchBookingNotificationContext(params.newBookingId);
  if (!context?.booking.email) return false;

  const resend = getResendClient();
  if (!resend) {
    console.warn("sendBookingTransferEmail skipped: RESEND_API_KEY not configured");
    return false;
  }

  const db = createSupabaseAdminClient();
  const { data: previousEvent } = await db
    .from("events")
    .select("title, start_at")
    .eq("id", params.previousEventId)
    .maybeSingle();

  const { date, time } = formatInLondon(context.event.start_at);
  const venueName = context.event.venue?.name ?? "the venue";
  const previousEventRow = previousEvent as { title: string; start_at: string } | null;
  const previousLine = previousEventRow
    ? `${previousEventRow.title} on ${formatInLondon(previousEventRow.start_at).date}`
    : null;

  const content = renderCustomerBookingEmailTemplate({
    headline: "Your booking has moved to a new date",
    intro: `Hi ${context.booking.first_name},`,
    body: [
      previousLine
        ? `${previousLine} has been rescheduled, and your booking has been moved to the new date below.`
        : "Your booking has been moved to a new date, shown below.",
    ],
    details: [
      { label: "Event", value: context.event.title },
      { label: "Venue", value: venueName },
      { label: "New date/time", value: `${date} at ${time}` },
      { label: "Tickets", value: context.booking.ticket_count },
      { label: "Booking reference", value: context.booking.id.slice(0, 8) },
    ],
    afterDetails: [
      isPaid
        ? "Your existing payment has been carried over to the new date — there is nothing more to pay and no need to rebook."
        : "There's nothing you need to do — we'll see you on the new date.",
    ],
  });

  try {
    await resend.emails.send({
      from: BOOKING_RESEND_FROM_ADDRESS,
      to: context.booking.email,
      subject: "Your booking has moved to a new date",
      html: content.html,
      text: content.text,
    });
    return true;
  } catch (error) {
    console.error("sendBookingTransferEmail failed", error);
    return false;
  }
}

/**
 * Notify a customer that an event has been cancelled. Used by the event
 * cancellation cascade for unpaid/free bookings (paid bookings receive the
 * refund email instead, so this is not sent to them to avoid double-emailing).
 * Returns false when the booking has no email or when sending fails.
 */
export async function sendEventCancellationEmail(params: {
  bookingId: string;
  reason?: string | null;
}): Promise<boolean> {
  if (!areBookingEmailsEnabled()) {
    logNotificationSkipped("event-cancellation", params.bookingId);
    return true;
  }

  const context = await fetchBookingNotificationContext(params.bookingId);
  if (!context?.booking.email) return false;

  const resend = getResendClient();
  if (!resend) {
    console.warn("sendEventCancellationEmail skipped: RESEND_API_KEY not configured");
    return false;
  }

  const { date, time } = formatInLondon(context.event.start_at);
  const venueName = context.event.venue?.name ?? "the venue";
  const content = renderCustomerBookingEmailTemplate({
    headline: "This event has been cancelled",
    intro: `Hi ${context.booking.first_name},`,
    body: [
      `We're sorry to let you know that ${context.event.title} has been cancelled and will no longer take place.`,
      ...(params.reason ? [params.reason] : []),
    ],
    details: [
      { label: "Event", value: context.event.title },
      { label: "Venue", value: venueName },
      { label: "Was scheduled for", value: `${date} at ${time}` },
      { label: "Booking reference", value: context.booking.id.slice(0, 8) },
    ],
    afterDetails: [
      "If you have any questions, please contact the venue directly.",
    ],
  });

  try {
    await resend.emails.send({
      from: BOOKING_RESEND_FROM_ADDRESS,
      to: context.booking.email,
      subject: `Event cancelled: ${context.event.title}`,
      html: content.html,
      text: content.text,
    });
    return true;
  } catch (error) {
    console.error("sendEventCancellationEmail failed", error);
    return false;
  }
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

async function fetchAnnouncementEventContext(eventId: string): Promise<AnnouncementEventContext | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await (supabase as any)
    .from("events")
    .select(
      `
      *,
      venue:venues!events_venue_id_fkey(name),
      creator:users!events_created_by_fkey(id,full_name,email),
      assignee:users!events_assignee_id_fkey(id,full_name,email),
      event_venues(venue_id, venue:venues(name))
    `
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not fetch event for announcement: ${error.message}`);
  }

  return (data as AnnouncementEventContext) ?? null;
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

function formatProposalStart(value: string | null): string {
  if (!value) return "Date not set";
  const start = new Date(value);
  if (Number.isNaN(start.getTime())) return "Date not set";
  return `${dateFormatter.format(start)} · ${timeFormatter.format(start)}`;
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

async function fetchProposalEventContext(eventId: string): Promise<ProposalEventContext | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await (supabase as any)
    .from("events")
    .select(
      `
      *,
      venue:venues!events_venue_id_fkey(name),
      creator:users!events_created_by_fkey(id,full_name,email),
      event_venues(venue_id, venue:venues(name))
    `
    )
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not fetch proposal event for notification: ${error.message}`);
  }

  return (data as ProposalEventContext) ?? null;
}

async function claimProposalEmailSend(params: {
  eventId: string;
  idempotencyKey: string;
  userId: string;
}): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const response = {
    success: true,
    event_id: params.eventId,
    proposal_email: "claimed"
  };

  const { error: insertError } = await (db as any)
    .from("event_save_idempotency")
    .upsert(
      {
        idempotency_key: params.idempotencyKey,
        user_id: params.userId,
        event_id: params.eventId,
        response,
        created_at: now,
      },
      { onConflict: "idempotency_key,user_id", ignoreDuplicates: true }
    );

  if (insertError) {
    throw new Error(`Could not create proposal email idempotency row: ${insertError.message}`);
  }

  const { data, error } = await (db as any)
    .from("event_save_idempotency")
    .update({
      event_id: params.eventId,
      proposal_email_sent_at: now,
    })
    .eq("idempotency_key", params.idempotencyKey)
    .eq("user_id", params.userId)
    .is("proposal_email_sent_at", null)
    .select("idempotency_key")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not claim proposal email send: ${error.message}`);
  }

  return Boolean(data);
}

export async function sendProposalSubmittedEmailOnce(params: {
  eventId: string;
  idempotencyKey: string;
  userId: string;
}): Promise<void> {
  if (!areOperationalEmailsEnabled()) {
    logNotificationSkipped("sendProposalSubmittedEmailOnce", { eventId: params.eventId });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const shouldSend = await claimProposalEmailSend(params);
    if (!shouldSend) return;

    const [event, recipients] = await Promise.all([
      fetchProposalEventContext(params.eventId),
      resolveCentralEventsLeadRecipients(),
    ]);
    if (!event || recipients.length === 0) return;

    const venueNames = event.event_venues && event.event_venues.length > 0
      ? event.event_venues.map((entry) => entry.venue?.name).filter((name): name is string => Boolean(name))
      : [event.venue?.name ?? "Unknown venue"];
    const uniqueVenues = [...new Set(venueNames)];
    const creatorName = event.creator?.full_name ?? event.creator?.email ?? "A BaronsHub user";
    const notes = typeof event.notes === "string" && event.notes.trim().length > 0
      ? event.notes.trim()
      : "No proposal notes supplied.";

    const { html, text } = renderEmailTemplate({
      headline: "New event proposal submitted",
      intro: `${creatorName} submitted "${event.title}" for review.`,
      body: [
        notes,
      ],
      button: { label: "Review proposal", url: eventLink(event.id) },
      meta: [
        `Event: ${event.title}`,
        `Date: ${formatProposalStart(event.start_at)}`,
        `Venue: ${uniqueVenues.join(", ")}`,
        `Submitted by: ${creatorName}`,
      ]
    });

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: recipients.map((recipient) => recipient.email),
      subject: `New event proposal: ${event.title}`,
      html,
      text
    });
  } catch (error) {
    console.warn("Failed to send proposal submitted email", error);
  }
}

type BuiltEmail = { subject: string; html: string; text: string };

/**
 * Wording is identical to the original sendEventSubmittedEmail body. Only the
 * greeting name is now passed in, so the orchestrator can address whichever
 * recipient the planner picked.
 */
function buildSubmittedForReviewEmail(
  event: NewEventEmailContext,
  recipientName: string | null
): BuiltEmail {
  const { html, text } = renderEmailTemplate({
    headline: "New event waiting for review",
    intro: `${buildGreeting({ full_name: recipientName }, "Hello")} ${event.creator?.full_name ?? "A venue manager"} just sent in "${event.title}".`,
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
  return { subject: `New event ready for review: ${event.title}`, html, text };
}

/**
 * Wording is identical to the original sendNewEventAnnouncementEmail body.
 */
function buildAnnouncementEmail(
  event: EventRow,
  venueLabel: string,
  recipientName: string | null
): BuiltEmail {
  const { html, text } = renderEmailTemplate({
    headline: "New event coming soon!",
    intro: `${buildGreeting({ full_name: recipientName })} "${event.title}" has just been added to BaronsHub.`,
    body: [
      "The plan is now live for the team, with dates, venue details and next steps ready to review.",
      "Open the event to see what is coming up and where your team fits in."
    ],
    button: { label: "Open event", url: eventLink(event.id) },
    meta: [
      `Event: ${event.title}`,
      `Venue: ${venueLabel}`,
      `When: ${formatEventWindow(event)}`,
      formatSpacesLabel(event.venue_space)
    ]
  });
  return { subject: `New event coming soon: ${event.title}`, html, text };
}

/**
 * Wording is identical to the original sendReviewDecisionEmail body. The
 * recipient is always the event creator, so the greeting still reads from
 * event.creator.
 */
function buildReviewDecisionEmail(
  event: NewEventEmailContext,
  decision: string
): BuiltEmail {
  const { html, text } = renderEmailTemplate({
    headline: `Your event is now marked ${decision.replace(/_/g, " ")}`,
    intro: `${buildGreeting(event.creator)} "${event.title}" has moved to ${decision.replace(/_/g, " ")}.`,
    body: [
      "Review the notes and make any updates needed so we can keep momentum.",
      "Once everything looks good, push the latest version live."
    ],
    button: { label: "Open your event", url: eventLink(event.id) },
    meta: [
      `Event: ${event.title}`,
      `Venue: ${event.venue?.name ?? "Unknown venue"}`,
      `When: ${formatEventWindow(event)}`,
      `Status: ${decision.replace(/_/g, " ")}`
    ]
  });
  return { subject: `Update on your event: ${event.title}`, html, text };
}

export async function sendReviewDecisionEmail(eventId: string, decision: string) {
  if (!areOperationalEmailsEnabled()) {
    logNotificationSkipped("sendReviewDecisionEmail", { eventId, decision });
    return;
  }
  const resend = getResendClient();
  if (!resend) return;

  try {
    const event = await fetchEventContext(eventId);
    if (!event?.creator?.email) return;

    const built = buildReviewDecisionEmail(event, decision);

    await resend.emails.send({
      from: RESEND_FROM_ADDRESS,
      to: event.creator.email,
      subject: built.subject,
      html: built.html,
      text: built.text
    });
  } catch (error) {
    console.warn("Failed to send decision email", error);
  }
}

/**
 * Every active user with an email, in a stable order. There is deliberately NO
 * venue filter: product decision 2026-07-23 is that the new-event announcement
 * goes to every application user.
 */
async function listActiveNotificationPeople(): Promise<NotificationPerson[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("users")
    .select("id, email, full_name, venue_id, is_central_events_lead, role")
    .is("deactivated_at", null)
    .not("email", "is", null)
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not list users for new-event notifications: ${error.message}`);
  }

  type ActiveUserRow = Pick<
    UserRow,
    "id" | "email" | "full_name" | "venue_id" | "is_central_events_lead" | "role"
  >;

  return ((data ?? []) as ActiveUserRow[])
    .filter((user) => Boolean(user.email))
    .map((user) => ({
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      venueId: user.venue_id,
      isCentralEventsLead: Boolean(user.is_central_events_lead),
      isAdministrator: user.role === "administrator"
    }));
}

/**
 * Turns an event's creator or assignee join into a planner person. Prefers the
 * canonical active-user record so venue and role stay accurate; falls back to
 * the join when the person is deactivated, because a targeted confirmation
 * still belongs to them.
 */
function toPerson(
  user: Pick<UserRow, "id" | "email" | "full_name"> | null | undefined,
  activeUsers: NotificationPerson[]
): NotificationPerson | null {
  if (!user?.id || !user.email) return null;
  const known = activeUsers.find((person) => person.userId === user.id);
  if (known) return known;
  return {
    userId: user.id,
    email: user.email,
    fullName: user.full_name,
    venueId: null,
    isCentralEventsLead: false,
    isAdministrator: false
  };
}

/** The event's own venue plus every linked multi-venue entry, deduplicated. */
function collectVenueIds(event: AnnouncementEventContext): string[] {
  return Array.from(
    new Set(
      [event.venue_id, ...(event.event_venues ?? []).map((link) => link.venue_id)].filter(
        (id): id is string => Boolean(id)
      )
    )
  );
}

/** Human-readable venue list for the announcement meta block. */
function buildVenueLabel(event: AnnouncementEventContext): string {
  const names = Array.from(
    new Set(
      [event.venue?.name, ...(event.event_venues ?? []).map((link) => link.venue?.name)].filter(
        (name): name is string => Boolean(name)
      )
    )
  );
  return names.length ? names.join(", ") : "Venue to be confirmed";
}

/**
 * Takes the at-most-once barrier for the new-event announcement. Returns false
 * when somebody else already holds it, which is a normal outcome rather than an
 * error.
 */
async function claimNewEventAnnouncement(params: {
  eventId: string;
  actorUserId: string;
  plannedCount: number;
}): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("event_notification_claims")
    .insert({
      event_id: params.eventId,
      transition_key: "new_event",
      claimed_by: params.actorUserId,
      planned_count: params.plannedCount
    })
    .select("event_id")
    .maybeSingle();

  // Unique violation means somebody else already claimed it. Not an error.
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`Could not claim new-event announcement: ${error.message}`);
  }
  return Boolean(data);
}

/** Re-arms the announcement after a total send failure. */
async function releaseNewEventAnnouncementClaim(eventId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await (db as any)
    .from("event_notification_claims")
    .delete()
    .eq("event_id", eventId)
    .eq("transition_key", "new_event");
}

/**
 * Sends exactly one email per person for a new event.
 *
 * The planner decides who gets what; this function only performs I/O. The
 * claim gates the ANNOUNCEMENT subset only, so a revert-and-republish still
 * delivers the creator's targeted confirmation without re-broadcasting.
 */
export async function notifyNewEvent(params: {
  eventId: string;
  actorUserId: string;
  transition: NewEventTransition;
  isFirstPublish: boolean;
}): Promise<void> {
  if (!areOperationalEmailsEnabled()) {
    logNotificationSkipped("notifyNewEvent", { eventId: params.eventId });
    return; // never claim when email is off
  }
  const resend = getResendClient();
  if (!resend) return; // never claim without a provider

  try {
    const [event, activeUsers] = await Promise.all([
      fetchAnnouncementEventContext(params.eventId),
      listActiveNotificationPeople()
    ]);
    if (!event) return;

    const plan = planNewEventNotifications({
      transition: params.transition,
      isFirstPublish: params.isFirstPublish,
      actorUserId: params.actorUserId,
      eventVenueIds: collectVenueIds(event),
      creator: toPerson(event.creator, activeUsers),
      assignee: toPerson(event.assignee, activeUsers),
      activeUsers
    });

    let messages = plan.messages;
    let claimed = false;

    if (plan.requiresClaim && messages.some((message) => message.kind === "announcement")) {
      claimed = await claimNewEventAnnouncement({
        eventId: params.eventId,
        actorUserId: params.actorUserId,
        plannedCount: messages.length
      });
      if (!claimed) {
        messages = messages.filter((message) => message.kind !== "announcement");
      }
    }

    if (messages.length === 0) return;

    const venueLabel = buildVenueLabel(event);
    const payload = messages.map((message) => {
      const built =
        message.kind === "announcement"
          ? buildAnnouncementEmail(event, venueLabel, message.fullName)
          : message.kind === "submitted_for_review"
            ? buildSubmittedForReviewEmail(event, message.fullName)
            : buildReviewDecisionEmail(event, "approved");
      return {
        from: RESEND_FROM_ADDRESS,
        to: [message.sendTo],
        subject: built.subject,
        html: built.html,
        text: built.text
      };
    });

    const response = await resend.batch.send(payload, {
      idempotencyKey: `new-event:${params.eventId}:${params.transition}`
    });

    // Resend RESOLVES on provider error rather than rejecting. Never treat a
    // resolved promise as success.
    const accepted = response.error ? 0 : (response.data?.data?.length ?? 0);
    const failed = payload.length - accepted;

    console.log(
      JSON.stringify({
        event: "notify_new_event",
        eventId: params.eventId,
        transition: params.transition,
        planned: payload.length,
        accepted,
        failed,
        suppressed: plan.suppressed.length,
        error: response.error?.message ?? null
      })
    );

    // Release only on TOTAL failure. Partial success keeps the claim so a retry
    // cannot duplicate.
    if (claimed && accepted === 0) {
      await releaseNewEventAnnouncementClaim(params.eventId);
    }
  } catch (error) {
    console.warn("notifyNewEvent failed", error);
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
      headline: "You've been invited to BaronsHub 1.1",
      intro: `${greeting} you've been invited to join the BaronsHub 1.1 planning platform.`,
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
      subject: "You've been invited to BaronsHub 1.1",
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
      headline: "Reset your BaronsHub 1.1 password",
      intro: "Hi there — we received a request to reset your BaronsHub 1.1 password.",
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
      subject: "Reset your BaronsHub 1.1 password",
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
  if (!areOperationalEmailsEnabled()) {
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
  if (!areOperationalEmailsEnabled()) {
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
  if (!areOperationalEmailsEnabled()) {
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
  if (!areOperationalEmailsEnabled()) {
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
  if (!areOperationalEmailsEnabled()) {
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
      footerNote: "You’re receiving this because you’re listed as an administrator in BaronsHub 1.1."
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
  if (!areOperationalEmailsEnabled()) {
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
      footerNote: "You're receiving this because you're a member of the SLT distribution list in BaronsHub 1.1."
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
 * Fetch ALL rows for a Supabase query, paging past PostgREST's 1000-row response cap.
 * The builder MUST apply a stable .order() so range/offset pages don't skip or repeat rows.
 */
async function fetchDigestRows<T>(label: string, buildQuery: () => any): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const query = buildQuery();
    const canPage = typeof query.range === "function";
    const result = canPage ? await query.range(from, from + pageSize - 1) : await query;
    if (result.error) throw new Error(`Failed to fetch ${label}: ${result.error.message}`);
    const page = (result.data ?? []) as T[];
    rows.push(...page);
    if (!canPage || page.length < pageSize) return rows;
  }
}

/**
 * Mandatory Tuesday weekly update.
 *
 * Sends to every active user once per ISO week. Personal to-dos are per-user;
 * approved/debriefed sections are venue-scoped when a user has `venue_id`,
 * otherwise global.
 */
export async function sendMandatoryWeeklyUpdateEmail(): Promise<{ sent: number; failed: number; skippedAssignees: number }> {
  if (!areOperationalEmailsEnabled()) {
    logNotificationSkipped("sendMandatoryWeeklyUpdateEmail");
    return { sent: 0, failed: 0, skippedAssignees: 0 };
  }
  const resend = getResendClient();
  if (!resend) return { sent: 0, failed: 0, skippedAssignees: 0 };

  const todayLondon = getTodayLondonIsoDate();
  const weekday = new Date(`${todayLondon}T12:00:00Z`).getUTCDay();
  if (weekday !== 2) {
    return { sent: 0, failed: 0, skippedAssignees: 0 };
  }

  function isoWeekStart(value: string): string {
    const date = new Date(`${value}T12:00:00Z`);
    const dayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - dayOffset);
    return date.toISOString().slice(0, 10);
  }

  function firstRelation<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  function eventVenueIds(event: { venue_id?: string | null; event_venues?: Array<{ venue_id: string | null }> | null }): Set<string> {
    const ids = new Set<string>();
    if (event.venue_id) ids.add(event.venue_id);
    for (const link of event.event_venues ?? []) {
      if (link.venue_id) ids.add(link.venue_id);
    }
    return ids;
  }

  function formatEventDate(value: string | null): string {
    if (!value) return "Date not set";
    return formatInLondon(value).date;
  }

  function formatUplift(value: number | null | undefined): string {
    return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "N/A";
  }

  const db = createSupabaseAdminClient();
  await markPastEventOpenTodosNotRequired();
  const weekStart = isoWeekStart(todayLondon);
  const todoDueLimit = addDays(todayLondon, 14);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  type WeeklyUser = {
    id: string;
    email: string;
    full_name: string | null;
    venue_id: string | null;
    weekly_digest_last_sent_on: string | null;
  };
  type WeeklyTask = {
    id: string;
    title: string;
    dueDate: string | null;
    planningTitle: string;
    eventTitle: string | null;
  };

  const [userRows, assigneeRows, legacyTasks, approvalAuditResult, debriefsResult] = await Promise.all([
    fetchDigestRows<WeeklyUser>("weekly update users", () =>
      db
        .from("users")
        .select("id, email, full_name, venue_id, weekly_digest_last_sent_on")
        .is("deactivated_at", null)
        .order("id", { ascending: true })
    ),

    fetchDigestRows<Record<string, unknown>>("weekly assignee tasks", () =>
      (db as any)
        .from("planning_task_assignees")
        .select(`
          user_id,
          planning_task:planning_tasks!inner(
            id, title, due_date, assignee_id, status,
            planning_item:planning_items!inner(id, title, event:events(id, title, venue_id, event_venues(venue_id)))
          )
        `)
        .not("user_id", "is", null)
        .order("id", { ascending: true })
    ),

    fetchDigestRows<Record<string, unknown>>("weekly legacy tasks", () =>
      (db as any)
        .from("planning_tasks")
        .select(`
          id, title, due_date, assignee_id, status,
          planning_item:planning_items!inner(id, title, event:events(id, title, venue_id, event_venues(venue_id)))
        `)
        .eq("status", "open")
        .lte("due_date", todoDueLimit)
        .not("assignee_id", "is", null)
        .order("id", { ascending: true })
    ),

    // audit_log + debriefs are intentionally NOT paginated: both are bounded by the 7-day window
    // (sevenDaysAgo) and stay well under PostgREST's 1000-row cap. See spec §10 (out of scope).
    db
      .from("audit_log")
      .select("entity_id, created_at")
      .eq("entity", "event")
      .eq("action", "event.approved")
      .gte("created_at", sevenDaysAgo),

    (db as any)
      .from("debriefs")
      .select("event_id, submitted_at, sales_uplift_percent, event:events(id, title, start_at, venue_id, venue:venues!events_venue_id_fkey(name), event_venues(venue_id))")
      .gte("submitted_at", sevenDaysAgo)
  ]);

  if (approvalAuditResult.error) throw new Error(`Could not load approved event audit rows: ${approvalAuditResult.error.message}`);
  if (debriefsResult.error) throw new Error(`Could not load debrief rows: ${debriefsResult.error.message}`);

  const users = userRows
    .filter((user) => Boolean(user.email))
    .filter((user) => !user.weekly_digest_last_sent_on || isoWeekStart(user.weekly_digest_last_sent_on) !== weekStart);
  const userMap = new Map(users.map((user) => [user.id, user]));
  const tasksByUser = new Map<string, Map<string, WeeklyTask>>();
  const taskIdsWithAssigneeRows = new Set<string>();
  let skippedAssignees = 0;

  function normaliseWeeklyTask(rawTask: unknown): WeeklyTask | null {
    const task = firstRelation(rawTask as Record<string, unknown> | Array<Record<string, unknown>> | null);
    if (!task || (task.status && task.status !== "open")) return null;
    const dueDate = typeof task.due_date === "string" ? task.due_date : null;
    if (!dueDate || dueDate > todoDueLimit) return null;

    const planningItem = firstRelation(task.planning_item as Record<string, unknown> | Array<Record<string, unknown>> | null);
    if (!planningItem) return null;
    const event = firstRelation(planningItem.event as Record<string, unknown> | Array<Record<string, unknown>> | null);

    return {
      id: String(task.id),
      title: String(task.title ?? "Untitled task"),
      dueDate,
      planningTitle: String(planningItem.title ?? "Untitled planning item"),
      eventTitle: event ? String(event.title ?? "Untitled event") : null
    };
  }

  function addTask(userId: string | null | undefined, task: WeeklyTask | null): void {
    if (!userId || !task) return;
    if (!userMap.has(userId)) {
      skippedAssignees++;
      return;
    }
    const tasks = tasksByUser.get(userId) ?? new Map<string, WeeklyTask>();
    tasks.set(task.id, task);
    tasksByUser.set(userId, tasks);
  }

  for (const row of assigneeRows as Array<Record<string, unknown>>) {
    const task = normaliseWeeklyTask(row.planning_task ?? row.planning_tasks);
    if (task) taskIdsWithAssigneeRows.add(task.id);
    addTask(typeof row.user_id === "string" ? row.user_id : null, task);
  }

  for (const rawTask of legacyTasks as Array<Record<string, unknown>>) {
    const task = normaliseWeeklyTask(rawTask);
    if (task && taskIdsWithAssigneeRows.has(task.id)) continue;
    addTask(typeof rawTask.assignee_id === "string" ? rawTask.assignee_id : null, task);
  }

  const approvedEventIds = [...new Set(((approvalAuditResult.data ?? []) as Array<{ entity_id: string | null }>).map((row) => row.entity_id).filter((id): id is string => Boolean(id)))];
  const approvedEvents = approvedEventIds.length > 0
    ? await (db as any)
      .from("events")
      .select("id, title, start_at, venue_id, venue:venues!events_venue_id_fkey(name), event_venues(venue_id)")
      .in("id", approvedEventIds)
      .is("deleted_at", null)
    : { data: [], error: null };
  if (approvedEvents.error) throw new Error(`Could not load approved events: ${approvedEvents.error.message}`);

  type WeeklyEvent = {
    id: string;
    title: string;
    start_at: string | null;
    venue_id: string | null;
    venue: { name: string | null } | Array<{ name: string | null }> | null;
    event_venues?: Array<{ venue_id: string | null }> | null;
  };
  type WeeklyDebrief = {
    event_id: string;
    submitted_at: string;
    sales_uplift_percent: number | null;
    event: WeeklyEvent | WeeklyEvent[] | null;
  };

  const approvedRows = (approvedEvents.data ?? []) as WeeklyEvent[];
  const debriefRows = (debriefsResult.data ?? []) as WeeklyDebrief[];

  function inUserScope(user: WeeklyUser, event: WeeklyEvent): boolean {
    if (!user.venue_id) return true;
    return eventVenueIds(event).has(user.venue_id);
  }

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      const todoTasks = Array.from(tasksByUser.get(user.id)?.values() ?? [])
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.title.localeCompare(b.title));
      const userApproved = approvedRows.filter((event) => inUserScope(user, event));
      const userDebriefs = debriefRows
        .map((row) => ({ ...row, event: firstRelation(row.event) }))
        .filter((row): row is WeeklyDebrief & { event: WeeklyEvent } => {
          const event = row.event;
          return Boolean(event) && inUserScope(user, event as WeeklyEvent);
        });

      const approvedItems = userApproved.slice(0, 20).map((event) => {
        const venue = firstRelation(event.venue);
        return {
          title: event.title,
          detail: `${formatEventDate(event.start_at)} · ${venue?.name ?? "Unknown venue"}`
        };
      });

      const visibleTodoTasks = todoTasks.slice(0, WEEKLY_UPDATE_TODO_EMAIL_LIMIT);
      const todoItems = visibleTodoTasks.map((task) => {
        const due = task.dueDate ? formatInLondon(`${task.dueDate}T00:00:00Z`).date : "TBD";
        const context = task.eventTitle ? `${task.planningTitle} / ${task.eventTitle}` : task.planningTitle;
        return {
          title: task.title,
          detail: `${due} · ${context}`
        };
      });

      const debriefItems = userDebriefs.slice(0, 20).map((debrief) => {
        const venue = firstRelation(debrief.event.venue);
        return {
          title: debrief.event.title,
          detail: `${formatEventDate(debrief.event.start_at)} · ${venue?.name ?? "Unknown venue"} · uplift ${formatUplift(debrief.sales_uplift_percent)}`
        };
      });

      const { html, text } = renderWeeklyUpdateEmail({
        recipientName: user.full_name,
        approvedEvents: approvedItems,
        todoItems,
        todoOverflowCount: Math.max(0, todoTasks.length - visibleTodoTasks.length),
        debriefs: debriefItems,
        appUrl: plannerDashboardLink()
      });

      await resend.emails.send({
        from: RESEND_FROM_ADDRESS,
        to: [user.email],
        subject: "Your weekly BaronsHub update",
        html,
        text
      });

      const { error: sentUpdateError } = await db
        .from("users")
        .update({ weekly_digest_last_sent_on: todayLondon })
        .eq("id", user.id);
      if (sentUpdateError) {
        console.error(`sendMandatoryWeeklyUpdateEmail: failed to record sent date for ${user.id}`, sentUpdateError);
      }

      sent++;
    } catch (error) {
      console.error(`sendMandatoryWeeklyUpdateEmail: failed for user ${user.id}`, error);
      failed++;
    }
  }

  try {
    await db.from("audit_log").insert({
      entity: "digest",
      entity_id: weekStart,
      action: "digest.batch_sent",
      actor_id: null,
      meta: { sent, failed, skipped_assignees: skippedAssignees, weekly_update: true, date: todayLondon } as unknown as Database["public"]["Tables"]["audit_log"]["Row"]["meta"]
    });
  } catch (auditError) {
    console.error("sendMandatoryWeeklyUpdateEmail: failed to record audit entry", auditError);
  }

  return { sent, failed, skippedAssignees };
}

/**
 * Sends a todo digest email to active users who have planning tasks needing
 * attention, based on their communication preferences.
 *
 * Content:
 * 1. Open tasks overdue or due in the next 7 days, grouped by planning item
 *    (with event title as context if linked)
 * 2. Upcoming events in the next 4 days (venue-scoped for users with venue_id)
 *
 * Idempotent per calendar day (London timezone) — duplicate runs on the same day are skipped.
 */
export async function sendWeeklyDigestEmail(): Promise<{ sent: number; failed: number; skippedAssignees: number }> {
  if (!areOperationalEmailsEnabled()) {
    logNotificationSkipped("sendWeeklyDigestEmail");
    return { sent: 0, failed: 0, skippedAssignees: 0 };
  }
  const resend = getResendClient();
  if (!resend) return { sent: 0, failed: 0, skippedAssignees: 0 };

  const todayLondon = getTodayLondonIsoDate();
  const digestDueLimit = addDays(todayLondon, 7);
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

  await markPastEventOpenTodosNotRequired();

  // Parallel data fetch
  const nowIso = new Date().toISOString();
  const fourDaysFromNow = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString();

  const [assignedTaskRows, legacyTasks, upcomingEvents, users] = await Promise.all([
    fetchDigestRows<Record<string, unknown>>("planning task assignees", () =>
      db
        .from("planning_task_assignees")
        .select(`
          user_id,
          planning_task:planning_tasks!inner(
            id, title, due_date, assignee_id, status,
            planning_item:planning_items!inner(id, title, event:events(id, title, venue_id))
          )
        `)
        .not("user_id", "is", null)
        .order("id", { ascending: true })
    ),
    fetchDigestRows<Record<string, unknown>>("planning tasks", () =>
      db
        .from("planning_tasks")
        .select(`
          id, title, due_date, assignee_id, status,
          planning_item:planning_items!inner(id, title, event:events(id, title, venue_id))
        `)
        .eq("status", "open")
        .not("assignee_id", "is", null)
        .order("id", { ascending: true })
    ),
    fetchDigestRows<Record<string, unknown>>("upcoming events", () =>
      db
        .from("events")
        .select("id, title, start_at, end_at, venue_id, venue:venues!events_venue_id_fkey(name, is_internal)")
        .gte("start_at", nowIso)
        .lt("start_at", fourDaysFromNow)
        .in("status", ["approved", "submitted"])
        .is("deleted_at", null)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
    ),
    fetchDigestRows<{
      id: string;
      email: string;
      full_name: string | null;
      venue_id: string | null;
      todo_digest_frequency: string | null;
      todo_digest_last_sent_on: string | null;
    }>("users", () =>
      db
        .from("users")
        .select("id, email, full_name, venue_id, todo_digest_frequency, todo_digest_last_sent_on")
        .is("deactivated_at", null)
        .order("id", { ascending: true })
    )
  ]);

  type DigestPlanningItem = {
    id: string;
    title: string;
    event: { id: string; title: string; venue_id: string | null } | null;
  };
  type DigestTask = {
    id: string;
    title: string;
    dueDate: string | null;
    planningItem: DigestPlanningItem;
  };

  // Build user lookup
  type DigestUser = {
    email: string;
    fullName: string | null;
    venueId: string | null;
    todoDigestFrequency: ReturnType<typeof normaliseTodoDigestFrequency>;
    todoDigestLastSentOn: string | null;
  };
  const userMap = new Map<string, DigestUser>();
  for (const u of users) {
    userMap.set(u.id, {
      email: u.email,
      fullName: u.full_name,
      venueId: u.venue_id,
      todoDigestFrequency: normaliseTodoDigestFrequency(u.todo_digest_frequency),
      todoDigestLastSentOn: u.todo_digest_last_sent_on,
    });
  }

  const tasksByAssignee = new Map<string, Map<string, DigestTask>>();
  const taskIdsWithAssigneeRows = new Set<string>();
  let skippedAssignees = 0;

  function firstRelation<T>(value: T | T[] | null | undefined): T | null {
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }

  function normaliseDigestTask(rawTask: unknown): DigestTask | null {
    const task = firstRelation(rawTask as Record<string, unknown> | Array<Record<string, unknown>> | null);
    if (!task || (task.status && task.status !== "open")) return null;
    const planningItem = firstRelation(
      task.planning_item as Record<string, unknown> | Array<Record<string, unknown>> | null
    );
    if (!planningItem) return null;
    const event = firstRelation(
      planningItem.event as Record<string, unknown> | Array<Record<string, unknown>> | null
    );

    return {
      id: String(task.id),
      title: String(task.title ?? "Untitled task"),
      dueDate: typeof task.due_date === "string" ? task.due_date : null,
      planningItem: {
        id: String(planningItem.id),
        title: String(planningItem.title ?? "Untitled planning item"),
        event: event
          ? {
              id: String(event.id),
              title: String(event.title ?? "Untitled event"),
              venue_id: typeof event.venue_id === "string" ? event.venue_id : null
            }
          : null
      }
    };
  }

  function shouldIncludeDigestTask(task: DigestTask): boolean {
    return Boolean(task.dueDate && task.dueDate <= digestDueLimit);
  }

  function addTaskForAssignee(assigneeId: string | null | undefined, task: DigestTask | null): void {
    if (!assigneeId || !task) return;
    if (!shouldIncludeDigestTask(task)) return;
    if (!userMap.has(assigneeId)) {
      skippedAssignees++;
      return;
    }
    const existing = tasksByAssignee.get(assigneeId) ?? new Map<string, DigestTask>();
    existing.set(task.id, task);
    tasksByAssignee.set(assigneeId, existing);
  }

  for (const row of assignedTaskRows) {
    const task = normaliseDigestTask(row.planning_task ?? row.planning_tasks);
    if (task) taskIdsWithAssigneeRows.add(task.id);
    addTaskForAssignee(
      typeof row.user_id === "string" ? row.user_id : null,
      task
    );
  }

  for (const rawTask of legacyTasks) {
    const task = normaliseDigestTask(rawTask);
    if (task && taskIdsWithAssigneeRows.has(task.id)) continue;
    addTaskForAssignee(
      typeof rawTask.assignee_id === "string" ? rawTask.assignee_id : null,
      task
    );
  }

  let sent = 0;
  let failed = 0;

  for (const [assigneeId, assigneeTaskMap] of tasksByAssignee) {
    try {
      const user = userMap.get(assigneeId)!;
      if (!shouldSendTodoDigestToday(user.todoDigestFrequency, todayLondon, user.todoDigestLastSentOn)) {
        continue;
      }

      const assigneeTasks = Array.from(assigneeTaskMap.values());

      // Group tasks by planning item
      type PlanningGroup = {
        planningItemId: string;
        heading: string;
        tasks: { title: string; dueDate: string | null; urgency: "overdue" | "due_soon" | "later" }[];
        earliestDue: string;
      };
      const groupMap = new Map<string, PlanningGroup>();

      for (const task of assigneeTasks) {
        const pi = task.planningItem;
        const piId = pi.id;

        if (!groupMap.has(piId)) {
          let heading = pi.title;
          if (pi.event) {
            heading += ` \u2014 for ${pi.event.title}`;
          }
          groupMap.set(piId, {
            planningItemId: piId,
            heading,
            tasks: [],
            earliestDue: task.dueDate ?? "9999-12-31"
          });
        }

        const group = groupMap.get(piId)!;
        const dueDate = task.dueDate;
        const urgency = dueDate
          ? dueDate < todayLondon
            ? "overdue"
            : dueDate <= digestDueLimit
              ? "due_soon"
              : "later"
          : "later";
        group.tasks.push({
          title: task.title,
          dueDate,
          urgency
        });
        if (dueDate && dueDate < group.earliestDue) {
          group.earliestDue = dueDate;
        }
      }

      // Sort groups by earliest due date
      const sortedGroups = Array.from(groupMap.values()).sort(
        (a, b) => a.earliestDue.localeCompare(b.earliestDue)
      );

      // Sort tasks within each group: overdue first, then by due date
      for (const group of sortedGroups) {
        group.tasks.sort((a, b) => {
          const urgencyOrder = { overdue: 0, due_soon: 1, later: 2 };
          const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
          if (urgencyDiff !== 0) return urgencyDiff;
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return a.title.localeCompare(b.title);
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
          const formattedDate = task.dueDate
            ? formatInLondon(task.dueDate + "T00:00:00Z").date
            : "TBD";
          const urgencyLabel =
            task.urgency === "overdue" ? " overdue" : task.urgency === "due_soon" ? " due soon" : "";
          body.push(`  \u2022 ${task.title} \u2014 due ${formattedDate}${urgencyLabel}`);
          taskCount++;
        }
      }

      if (capped && totalTasks > 50) {
        body.push(`\u2026and ${totalTasks - 50} more tasks needing attention \u2014 view in BaronsHub 1.1`);
      }

      // Filter upcoming events by venue scope
      const recipientEvents = upcomingEvents.filter((evt) => {
        const venue = firstRelation((evt as unknown as { venue?: unknown }).venue as Record<string, unknown> | Array<Record<string, unknown>> | null);
        if (venue?.is_internal === true) return false;
        if (!user.venueId) return true;
        return (evt as unknown as { venue_id: string | null }).venue_id === user.venueId;
      });

      if (recipientEvents.length > 0) {
        body.push("", "Coming up in the next 4 days:");
        for (const evt of recipientEvents) {
          const when = formatEventWindow(evt as unknown as EventRow);
          const venue = firstRelation((evt as unknown as { venue?: unknown }).venue as Record<string, unknown> | Array<Record<string, unknown>> | null);
          const venueName = typeof venue?.name === "string" ? venue.name : "Unknown venue";
          body.push(`  \u2022 ${evt.title} \u2014 ${venueName}, ${when}`);
        }
      }

      const { html, text } = renderEmailTemplate({
        headline: "Your todo digest",
        intro: "Here\u2019s what\u2019s overdue or due in the next 7 days.",
        body,
        button: { label: "Open BaronsHub 1.1", url: plannerDashboardLink() },
        footerNote: `Manage todo email frequency: ${APP_BASE_URL}/account`
      });

      await resend.emails.send({
        from: RESEND_FROM_ADDRESS,
        to: [user.email],
        subject: `Your BaronsHub 1.1 todo digest \u2014 ${totalTasks} task${totalTasks === 1 ? "" : "s"} need${totalTasks === 1 ? "s" : ""} attention`,
        html,
        text
      });

      const { error: sentUpdateError } = await db
        .from("users")
        .update({ todo_digest_last_sent_on: todayLondon })
        .eq("id", assigneeId);

      if (sentUpdateError) {
        console.error(`sendWeeklyDigestEmail: failed to record sent date for ${assigneeId}`, sentUpdateError);
      }

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

export async function sendMonthlySalesReportEmail(params: {
  report: SalesReport;
  recipientEmail: string;
  testMode?: boolean;
}): Promise<{ sent: boolean; recipientEmail: string; reportMonth: string; transactionCount: number }> {
  const resend = getResendClient();
  if (!resend) {
    console.warn("sendMonthlySalesReportEmail skipped: RESEND_API_KEY not configured");
    return {
      sent: false,
      recipientEmail: params.recipientEmail,
      reportMonth: params.report.period.key,
      transactionCount: params.report.lineItems.length,
    };
  }

  const email = renderMonthlySalesReportEmail(params.report, {
    testMode: params.testMode ?? false,
    testRecipientEmail: params.testMode ? params.recipientEmail : undefined,
  });

  await resend.emails.send({
    from: RESEND_FROM_ADDRESS,
    to: [params.recipientEmail],
    subject: email.subject,
    html: email.html,
    text: email.text,
    attachments: buildMonthlySalesReportAttachments(params.report),
  });

  return {
    sent: true,
    recipientEmail: params.recipientEmail,
    reportMonth: params.report.period.key,
    transactionCount: params.report.lineItems.length,
  };
}
