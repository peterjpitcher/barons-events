/**
 * One-off utility: sends a sample "debrief submitted" SLT email to a single
 * hardcoded address (peter@orangejelly.co.uk) so the current template +
 * body-building logic can be previewed without modifying the slt_members
 * table or spamming the real SLT list.
 *
 * The email body + template HTML is duplicated from src/lib/notifications.ts
 * verbatim (as of 2026-04-18 / commit db64d12) so what's sent here matches
 * what SLT members would actually receive.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/send-sample-slt-debrief.ts [eventId]
 *
 * If eventId is omitted, the script picks the most recently submitted debrief.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
 * Optional env: RESEND_FROM_EMAIL (default matches notifications.ts), NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL.
 *
 * The NOTIFICATIONS_DISABLED kill-switch is intentionally NOT honoured here —
 * this script exists to preview the output regardless of that flag.
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const TEST_RECIPIENT = "peter@orangejelly.co.uk";

const RESEND_FROM_ADDRESS =
  process.env.RESEND_FROM_EMAIL ?? "BaronsHub <noreply@auth.orangejelly.co.uk>";
const APP_BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://baronshub.orangejelly.co.uk";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!RESEND_API_KEY) {
  console.error("Missing RESEND_API_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const resend = new Resend(RESEND_API_KEY);

// ───── verbatim copies from src/lib/notifications.ts ─────

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

function renderEmailTemplate({
  headline,
  intro,
  body = [],
  button,
  meta,
  footerNote
}: EmailContent): { html: string; text: string } {
  const safeHeadline = escapeHtml(headline);
  const safeIntro = escapeHtml(intro);
  const paragraphHtml = body.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  const metaHtml = meta?.length
    ? `<div class="meta">${meta.map((l) => escapeHtml(l)).join("<br />")}</div>`
    : "";
  const buttonHtml = button
    ? `<p style="text-align: center"><a class="button" href="${escapeHtml(button.url)}">${escapeHtml(button.label)}</a></p>`
    : "";
  const footerHtml = footerNote ? `<p>${escapeHtml(footerNote)}</p>` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${safeHeadline}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      body { margin: 0; padding: 0; font-family: "Geist", "Inter", "Helvetica Neue", Arial, sans-serif; background-color: #E7E0D4; color: #273640; }
      .wrapper { padding: 48px 16px; }
      .card { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 24px; box-shadow: 0 24px 55px -28px rgba(15, 27, 58, 0.3); overflow: hidden; }
      .header { background: linear-gradient(135deg, #273640, #1b2530); color: #B49A67; padding: 40px 40px 32px; text-align: center; }
      .header h1 { margin: 0; font-family: "Playfair Display", "Georgia", serif; font-size: 28px; letter-spacing: 0.04em; text-transform: uppercase; }
      .header p { margin: 12px 0 0; font-size: 15px; letter-spacing: 0.12em; text-transform: uppercase; }
      .content { padding: 40px 40px 32px; }
      .content h2 { margin: 0 0 16px; font-size: 22px; }
      .content p { margin: 0 0 16px; line-height: 1.6; font-size: 15px; }
      .button { display: inline-block; margin: 24px 0; padding: 14px 32px; background-color: #273640; color: #ffffff; border-radius: 999px; text-decoration: none; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; }
      .meta { margin-top: 24px; padding: 16px 20px; border-radius: 16px; background: rgba(39, 54, 64, 0.06); font-size: 13px; line-height: 1.5; }
      .footer { padding: 0 40px 40px; font-size: 13px; color: #6E3C3D; }
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

  return { html, text: textParts.join("\n") };
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

function formatEventWindow(e: { start_at: string; end_at: string }): string {
  const start = new Date(e.start_at);
  const end = new Date(e.end_at);
  return `${dateFormatter.format(start)} · ${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;
}

// ───── fetch an event + debrief ─────

async function pickEventId(): Promise<string> {
  const cli = process.argv[2];
  if (cli) return cli;

  // Prefer an event with a real debrief if one exists.
  const { data: withDebrief } = await db
    .from("debriefs")
    .select("event_id, submitted_at")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (withDebrief?.event_id) return withDebrief.event_id as string;

  // Otherwise pick the most recent event so the preview has real metadata.
  const { data, error } = await db
    .from("events")
    .select("id, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Could not pick event: ${error.message}`);
  if (!data?.id) throw new Error("No events exist to build a preview from.");
  return data.id as string;
}

const SAMPLE_DEBRIEF = {
  attendance: 138,
  wet_takings: 2450.5,
  food_takings: 1120.75,
  labour_hours: 26.5,
  labour_rate_gbp_at_submit: 12.71,
  promo_effectiveness: 4,
  highlights: "Strong turnout from the mailing list; bar queue stayed manageable all night.",
  issues: "Kitchen ran out of the feature burger at 20:30 — review prep volumes for next run."
};

async function fetchEventContext(eventId: string) {
  const { data, error } = await db
    .from("events")
    .select(
      `*, venue:venues!events_venue_id_fkey(name), creator:users!events_created_by_fkey(id,full_name,email), debrief:debriefs(*)`
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(`Could not fetch event: ${error.message}`);
  if (!data) throw new Error(`Event ${eventId} not found.`);
  return data as {
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    cost_total: number | string | null;
    venue: { name: string | null } | null;
    creator: { full_name: string | null } | null;
    debrief: {
      attendance: number | null;
      wet_takings: number | string | null;
      food_takings: number | string | null;
      labour_hours: number | null;
      labour_rate_gbp_at_submit: number | string | null;
      promo_effectiveness: number | null;
      highlights: string | null;
      issues: string | null;
    } | null;
  };
}

const ROI_TARGET_RATIO = 4;

// ───── verbatim body-building logic from sendDebriefSubmittedToSltEmail ─────

function buildBody(
  d: NonNullable<Awaited<ReturnType<typeof fetchEventContext>>["debrief"]>,
  eventCostTotal: number | string | null
): string[] {
  const body: string[] = [];
  if (d.attendance != null) body.push(`Attendance: ${d.attendance}.`);

  const wet = d.wet_takings != null ? Number(d.wet_takings) : null;
  const food = d.food_takings != null ? Number(d.food_takings) : null;
  if (wet != null || food != null) {
    const parts: string[] = [];
    if (wet != null) parts.push(`Wet £${wet.toFixed(2)}`);
    if (food != null) parts.push(`Food £${food.toFixed(2)}`);
    body.push(`Takings: ${parts.join(" · ")}.`);
  }

  let labourCost: number | null = null;
  if (typeof d.labour_hours === "number" && d.labour_rate_gbp_at_submit != null) {
    const rate = Number(d.labour_rate_gbp_at_submit);
    labourCost = d.labour_hours * rate;
    body.push(`Labour: ${d.labour_hours}h at £${rate.toFixed(2)}/hr — £${labourCost.toFixed(2)}.`);
  }

  // Return against a 1:4 target, explained in plain English for leadership.
  const totalTakings = (wet ?? 0) + (food ?? 0);
  const otherEventCost = eventCostTotal != null ? Number(eventCostTotal) : 0;
  const totalInvestment = (labourCost ?? 0) + otherEventCost;
  if (totalTakings > 0 && totalInvestment > 0) {
    const perPound = totalTakings / totalInvestment;
    const verdict = perPound >= ROI_TARGET_RATIO ? "ahead of target" : "below target";
    const breakdown = otherEventCost > 0 ? "labour plus other costs" : "labour only";
    body.push(
      `For every £1 we invested in this event, we made £${perPound.toFixed(2)} back in takings. ` +
        `Total spend £${totalInvestment.toFixed(2)} (${breakdown}); total takings £${totalTakings.toFixed(2)}. ` +
        `Our target is £${ROI_TARGET_RATIO} back for every £1 — this event is ${verdict}.`
    );
  }

  if (d.promo_effectiveness != null) body.push(`Promo effectiveness scored ${d.promo_effectiveness}/5.`);
  if (d.highlights) body.push(`Highlights: ${d.highlights}`);
  if (d.issues) body.push(`Issues: ${d.issues}`);
  return body;
}

// ───── main ─────

async function main() {
  const eventId = await pickEventId();
  const event = await fetchEventContext(eventId);

  const debrief = event.debrief ?? SAMPLE_DEBRIEF;
  const usingSample = !event.debrief;

  // For a preview on an event with no real cost_total, show a plausible
  // figure so the ROI line reflects the full "labour + event costs" form
  // that leadership will normally see. Real debriefs use the event's own
  // cost_total verbatim.
  const SAMPLE_COST_TOTAL = 450;
  const costTotalForBody = usingSample && event.cost_total == null
    ? SAMPLE_COST_TOTAL
    : event.cost_total;

  const body = buildBody(debrief, costTotalForBody);
  const baseSubject = `Debrief submitted: ${event.title}`;
  const subject = usingSample ? `[PREVIEW] ${baseSubject}` : baseSubject;
  const { html, text } = renderEmailTemplate({
    headline: subject,
    intro: `${event.creator?.full_name ?? "A venue manager"} has submitted the debrief for "${event.title}".`,
    body,
    button: { label: "View debrief", url: `${APP_BASE_URL}/debriefs/${eventId}` },
    meta: [
      `Venue: ${event.venue?.name ?? "Unknown venue"}`,
      `When: ${formatEventWindow(event)}`
    ],
    footerNote:
      "You're receiving this because you're a member of the SLT distribution list in BaronsHub."
  });

  console.log(`→ Sending SLT debrief preview to ${TEST_RECIPIENT}`);
  console.log(`  Event: ${event.title} (${eventId})`);
  console.log(`  From:  ${RESEND_FROM_ADDRESS}`);
  console.log(`  Lines: ${body.length} body paragraph(s)`);

  const result = await resend.emails.send({
    from: RESEND_FROM_ADDRESS,
    to: [TEST_RECIPIENT],
    subject,
    html,
    text
  });

  if ((result as { error?: unknown }).error) {
    console.error("Resend returned an error:", (result as { error: unknown }).error);
    process.exit(2);
  }
  console.log("✓ Sent. Resend id:", (result as { data?: { id?: string } }).data?.id ?? "(none)");
}

main().catch((err) => {
  console.error("send-sample-slt-debrief failed:", err);
  process.exit(1);
});
