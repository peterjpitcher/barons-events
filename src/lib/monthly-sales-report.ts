import { fromZonedTime } from "date-fns-tz";
import { DISPLAY_TIMEZONE } from "@/lib/datetime";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const REPORTABLE_PAYMENT_STATUSES = new Set(["completed", "partially_refunded", "refunded"]);

export type SalesReportPeriod = {
  year: number;
  month: number;
  key: string;
  label: string;
  startUtcIso: string;
  endUtcIso: string;
};

export type SalesReportLineItem = {
  transactionId: string;
  checkoutSessionId: string | null;
  bookingId: string;
  eventId: string;
  eventTitle: string;
  eventStartsAt: string | null;
  venueId: string | null;
  venueName: string;
  completedAt: string;
  ticketCount: number;
  grossPence: number;
  refundPence: number;
  netPence: number;
  currency: string;
  paymentStatus: string;
};

export type SalesReportLocationSummary = {
  venueId: string | null;
  venueName: string;
  currency: string;
  grossPence: number;
  refundPence: number;
  netPence: number;
  transactionCount: number;
  ticketCount: number;
};

export type SalesReportTotals = {
  currency: string;
  grossPence: number;
  refundPence: number;
  netPence: number;
  transactionCount: number;
  ticketCount: number;
};

export type SalesReport = {
  period: SalesReportPeriod;
  lineItems: SalesReportLineItem[];
  locationSummaries: SalesReportLocationSummary[];
  totals: SalesReportTotals[];
};

export type MonthlySalesReportSettings = {
  enabled: boolean;
  recipientEmail: string | null;
};

type PaymentRow = Record<string, unknown>;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatPeriodLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: DISPLAY_TIMEZONE,
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

function buildSalesReportPeriod(year: number, month: number): SalesReportPeriod {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid sales report period");
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const key = `${year}-${pad2(month)}`;

  return {
    year,
    month,
    key,
    label: formatPeriodLabel(year, month),
    startUtcIso: fromZonedTime(`${key}-01T00:00:00`, DISPLAY_TIMEZONE).toISOString(),
    endUtcIso: fromZonedTime(`${nextMonthYear}-${pad2(nextMonth)}-01T00:00:00`, DISPLAY_TIMEZONE).toISOString(),
  };
}

export function getSalesReportPeriodForMonth(periodKey: string): SalesReportPeriod {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) {
    throw new Error("Report period must use YYYY-MM format");
  }
  return buildSalesReportPeriod(Number(match[1]), Number(match[2]));
}

export function getPreviousSalesReportPeriod(referenceDate = new Date()): SalesReportPeriod {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(referenceDate);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("Could not resolve current London month");
  }

  return month === 1
    ? buildSalesReportPeriod(year - 1, 12)
    : buildSalesReportPeriod(year, month - 1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function oneRelation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }
  return asRecord(value);
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function getEventTitle(event: Record<string, unknown> | null): string {
  return asString(event?.public_title) ?? asString(event?.title) ?? "Untitled event";
}

function getVenue(event: Record<string, unknown> | null): { id: string | null; name: string } {
  const venue = oneRelation(event?.venue ?? event?.venues);
  return {
    id: asString(event?.venue_id) ?? asString(venue?.id),
    name: asString(venue?.name) ?? "Unknown location",
  };
}

export function buildSalesReportFromPaymentRows(
  period: SalesReportPeriod,
  rows: PaymentRow[]
): SalesReport {
  const lineItems = rows
    .map((row): SalesReportLineItem | null => {
      const status = asString(row.status) ?? "";
      const completedAt = asString(row.completed_at);
      if (!REPORTABLE_PAYMENT_STATUSES.has(status) || !completedAt) {
        return null;
      }

      const booking = oneRelation(row.booking ?? row.event_bookings);
      const event = oneRelation(row.event ?? row.events);
      const venue = getVenue(event);
      const grossPence = asNumber(row.amount_pence);
      const refundPence = asNumber(row.refunded_amount_pence);

      return {
        transactionId: asString(row.id) ?? "",
        checkoutSessionId: asString(row.stripe_checkout_session_id),
        bookingId: asString(row.booking_id) ?? asString(booking?.id) ?? "",
        eventId: asString(row.event_id) ?? asString(event?.id) ?? "",
        eventTitle: getEventTitle(event),
        eventStartsAt: asString(event?.start_at),
        venueId: venue.id,
        venueName: venue.name,
        completedAt,
        ticketCount: asNumber(booking?.ticket_count),
        grossPence,
        refundPence,
        netPence: grossPence - refundPence,
        currency: (asString(row.currency) ?? "gbp").toUpperCase(),
        paymentStatus: status,
      };
    })
    .filter((item): item is SalesReportLineItem => item !== null)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const summaryMap = new Map<string, SalesReportLocationSummary>();
  const totalsMap = new Map<string, SalesReportTotals>();

  for (const item of lineItems) {
    const locationKey = `${item.venueId ?? item.venueName}:${item.currency}`;
    const location = summaryMap.get(locationKey) ?? {
      venueId: item.venueId,
      venueName: item.venueName,
      currency: item.currency,
      grossPence: 0,
      refundPence: 0,
      netPence: 0,
      transactionCount: 0,
      ticketCount: 0,
    };
    location.grossPence += item.grossPence;
    location.refundPence += item.refundPence;
    location.netPence += item.netPence;
    location.transactionCount += 1;
    location.ticketCount += item.ticketCount;
    summaryMap.set(locationKey, location);

    const total = totalsMap.get(item.currency) ?? {
      currency: item.currency,
      grossPence: 0,
      refundPence: 0,
      netPence: 0,
      transactionCount: 0,
      ticketCount: 0,
    };
    total.grossPence += item.grossPence;
    total.refundPence += item.refundPence;
    total.netPence += item.netPence;
    total.transactionCount += 1;
    total.ticketCount += item.ticketCount;
    totalsMap.set(item.currency, total);
  }

  return {
    period,
    lineItems,
    locationSummaries: Array.from(summaryMap.values()).sort((a, b) =>
      a.venueName.localeCompare(b.venueName) || a.currency.localeCompare(b.currency)
    ),
    totals: Array.from(totalsMap.values()).sort((a, b) => a.currency.localeCompare(b.currency)),
  };
}

export async function fetchMonthlySalesReport(period: SalesReportPeriod): Promise<SalesReport> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("payment_transactions")
    .select(`
      id,
      booking_id,
      event_id,
      stripe_checkout_session_id,
      amount_pence,
      refunded_amount_pence,
      currency,
      status,
      completed_at,
      booking:event_bookings!payment_transactions_booking_id_fkey(id, ticket_count),
      event:events!payment_transactions_event_id_fkey(
        id,
        title,
        public_title,
        start_at,
        venue_id,
        venue:venues!events_venue_id_fkey(id, name)
      )
    `)
    .in("status", Array.from(REPORTABLE_PAYMENT_STATUSES))
    .not("completed_at", "is", null)
    .gte("completed_at", period.startUtcIso)
    .lt("completed_at", period.endUtcIso)
    .order("completed_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch monthly sales report: ${error.message}`);
  }

  return buildSalesReportFromPaymentRows(period, (data ?? []) as PaymentRow[]);
}

export async function fetchMonthlySalesReportSettings(): Promise<MonthlySalesReportSettings> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("business_settings")
    .select("accountant_sales_report_enabled, accountant_sales_report_email")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch monthly sales report settings: ${error.message}`);
  }

  return {
    enabled: data?.accountant_sales_report_enabled !== false,
    recipientEmail: asString(data?.accountant_sales_report_email),
  };
}

export async function hasMonthlySalesReportBeenSent(period: SalesReportPeriod): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("audit_log")
    .select("id")
    .eq("entity", "sales_report")
    .eq("entity_id", period.key)
    .eq("action", "sales_report.sent")
    .limit(1);

  if (error) {
    throw new Error(`Failed to check monthly sales report idempotency: ${error.message}`);
  }

  return Array.isArray(data) && data.length > 0;
}

export async function recordMonthlySalesReportSent(params: {
  report: SalesReport;
  recipientEmail: string;
}): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await (db as any).from("audit_log").insert({
    entity: "sales_report",
    entity_id: params.report.period.key,
    action: "sales_report.sent",
    actor_id: null,
    meta: {
      recipient_email: params.recipientEmail,
      report_month: params.report.period.key,
      transaction_count: params.report.lineItems.length,
      totals: params.report.totals,
      location_count: params.report.locationSummaries.length,
      sent_at: new Date().toISOString(),
    },
  });

  if (error) {
    throw new Error(`Failed to record monthly sales report audit entry: ${error.message}`);
  }
}

function sampleIso(period: SalesReportPeriod, day: number, time: string): string {
  return fromZonedTime(`${period.key}-${pad2(day)}T${time}`, DISPLAY_TIMEZONE).toISOString();
}

export function createSampleMonthlySalesReport(period: SalesReportPeriod): SalesReport {
  const rows: PaymentRow[] = [
    {
      id: "sample-tx-001",
      booking_id: "sample-booking-001",
      event_id: "sample-event-001",
      stripe_checkout_session_id: "cs_sample_duke_jazz_001",
      amount_pence: 4800,
      refunded_amount_pence: 0,
      currency: "gbp",
      status: "completed",
      completed_at: sampleIso(period, 3, "10:24:00"),
      booking: { id: "sample-booking-001", ticket_count: 4 },
      event: {
        id: "sample-event-001",
        title: "Jazz Night",
        public_title: "Jazz Night",
        start_at: sampleIso(period, 12, "19:30:00"),
        venue_id: "sample-venue-duke",
        venue: { id: "sample-venue-duke", name: "The Duke" },
      },
    },
    {
      id: "sample-tx-002",
      booking_id: "sample-booking-002",
      event_id: "sample-event-002",
      stripe_checkout_session_id: "cs_sample_duke_comedy_002",
      amount_pence: 3600,
      refunded_amount_pence: 1200,
      currency: "gbp",
      status: "partially_refunded",
      completed_at: sampleIso(period, 7, "14:12:00"),
      booking: { id: "sample-booking-002", ticket_count: 3 },
      event: {
        id: "sample-event-002",
        title: "Comedy Club",
        public_title: "Comedy Club",
        start_at: sampleIso(period, 18, "20:00:00"),
        venue_id: "sample-venue-duke",
        venue: { id: "sample-venue-duke", name: "The Duke" },
      },
    },
    {
      id: "sample-tx-003",
      booking_id: "sample-booking-003",
      event_id: "sample-event-003",
      stripe_checkout_session_id: "cs_sample_cricketers_quiz_003",
      amount_pence: 2500,
      refunded_amount_pence: 0,
      currency: "gbp",
      status: "completed",
      completed_at: sampleIso(period, 9, "16:46:00"),
      booking: { id: "sample-booking-003", ticket_count: 5 },
      event: {
        id: "sample-event-003",
        title: "Charity Quiz Night",
        public_title: "Charity Quiz Night",
        start_at: sampleIso(period, 16, "19:00:00"),
        venue_id: "sample-venue-cricketers",
        venue: { id: "sample-venue-cricketers", name: "The Cricketers" },
      },
    },
    {
      id: "sample-tx-004",
      booking_id: "sample-booking-004",
      event_id: "sample-event-004",
      stripe_checkout_session_id: "cs_sample_cricketers_tribute_004",
      amount_pence: 7200,
      refunded_amount_pence: 0,
      currency: "gbp",
      status: "completed",
      completed_at: sampleIso(period, 15, "09:38:00"),
      booking: { id: "sample-booking-004", ticket_count: 6 },
      event: {
        id: "sample-event-004",
        title: "Tom Jones Tribute Night",
        public_title: "Tom Jones Tribute Night",
        start_at: sampleIso(period, 24, "20:00:00"),
        venue_id: "sample-venue-cricketers",
        venue: { id: "sample-venue-cricketers", name: "The Cricketers" },
      },
    },
    {
      id: "sample-tx-005",
      booking_id: "sample-booking-005",
      event_id: "sample-event-005",
      stripe_checkout_session_id: "cs_sample_barons_cross_supper_005",
      amount_pence: 3000,
      refunded_amount_pence: 3000,
      currency: "gbp",
      status: "refunded",
      completed_at: sampleIso(period, 20, "11:05:00"),
      booking: { id: "sample-booking-005", ticket_count: 2 },
      event: {
        id: "sample-event-005",
        title: "Supper Club",
        public_title: "Supper Club",
        start_at: sampleIso(period, 25, "18:30:00"),
        venue_id: "sample-venue-barons-cross",
        venue: { id: "sample-venue-barons-cross", name: "Barons Cross" },
      },
    },
    {
      id: "sample-tx-006",
      booking_id: "sample-booking-006",
      event_id: "sample-event-006",
      stripe_checkout_session_id: "cs_sample_barons_cross_acoustic_006",
      amount_pence: 4000,
      refunded_amount_pence: 0,
      currency: "gbp",
      status: "completed",
      completed_at: sampleIso(period, 24, "13:51:00"),
      booking: { id: "sample-booking-006", ticket_count: 4 },
      event: {
        id: "sample-event-006",
        title: "Acoustic Friday",
        public_title: "Acoustic Friday",
        start_at: sampleIso(period, 26, "19:30:00"),
        venue_id: "sample-venue-barons-cross",
        venue: { id: "sample-venue-barons-cross", name: "Barons Cross" },
      },
    },
  ];

  return buildSalesReportFromPaymentRows(period, rows);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function penceToDecimal(pence: number): string {
  return (pence / 100).toFixed(2);
}

function formatMoney(pence: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(pence / 100);
}

function formatReportDateTime(isoString: string | null): string {
  if (!isoString) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(isoString));
}

function totalsLabel(totals: SalesReportTotals[]): string {
  if (!totals.length) return "GBP 0.00";
  return totals.map((total) => formatMoney(total.netPence, total.currency)).join(", ");
}

export function buildMonthlySalesReportSummaryCsv(report: SalesReport): string {
  const rows = [
    ["Location", "Currency", "Gross sales", "Refunds", "Net sales", "Transactions", "Tickets"],
    ...report.locationSummaries.map((summary) => [
      summary.venueName,
      summary.currency,
      penceToDecimal(summary.grossPence),
      penceToDecimal(summary.refundPence),
      penceToDecimal(summary.netPence),
      summary.transactionCount,
      summary.ticketCount,
    ]),
  ];

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function buildMonthlySalesReportDetailCsv(report: SalesReport): string {
  const rows = [
    [
      "Payment date",
      "Location",
      "Event date",
      "Event",
      "Booking reference",
      "Currency",
      "Gross sales",
      "Refunds",
      "Net sales",
      "Tickets",
      "Payment status",
      "Stripe checkout session",
    ],
    ...report.lineItems.map((item) => [
      formatReportDateTime(item.completedAt),
      item.venueName,
      formatReportDateTime(item.eventStartsAt),
      item.eventTitle,
      item.bookingId,
      item.currency,
      penceToDecimal(item.grossPence),
      penceToDecimal(item.refundPence),
      penceToDecimal(item.netPence),
      item.ticketCount,
      item.paymentStatus,
      item.checkoutSessionId ?? "",
    ]),
  ];

  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function buildMonthlySalesReportAttachments(report: SalesReport): Array<{
  filename: string;
  content: Buffer;
  contentType: string;
}> {
  return [
    {
      filename: `baronshub-sales-summary-${report.period.key}.csv`,
      content: Buffer.from(buildMonthlySalesReportSummaryCsv(report), "utf8"),
      contentType: "text/csv",
    },
    {
      filename: `baronshub-sales-detail-${report.period.key}.csv`,
      content: Buffer.from(buildMonthlySalesReportDetailCsv(report), "utf8"),
      contentType: "text/csv",
    },
  ];
}

export function renderMonthlySalesReportEmail(report: SalesReport, options: {
  testMode?: boolean;
  testRecipientEmail?: string;
} = {}): { subject: string; html: string; text: string } {
  const subjectPrefix = options.testMode ? "[TEST] " : "";
  const subject = `${subjectPrefix}BaronsHub sales report - ${report.period.label}`;
  const testNotice = options.testMode
    ? `This is a test copy for approval${options.testRecipientEmail ? ` sent to ${options.testRecipientEmail}` : ""}. Julie has not been emailed.`
    : "";
  const summaryRows = report.locationSummaries
    .map((summary) => `
      <tr>
        <td>${escapeHtml(summary.venueName)}</td>
        <td>${escapeHtml(summary.currency)}</td>
        <td class="number">${escapeHtml(formatMoney(summary.grossPence, summary.currency))}</td>
        <td class="number">${escapeHtml(formatMoney(summary.refundPence, summary.currency))}</td>
        <td class="number strong">${escapeHtml(formatMoney(summary.netPence, summary.currency))}</td>
        <td class="number">${summary.transactionCount}</td>
        <td class="number">${summary.ticketCount}</td>
      </tr>`)
    .join("");
  const totalsRows = report.totals
    .map((total) => `
      <tr class="total">
        <td>All locations</td>
        <td>${escapeHtml(total.currency)}</td>
        <td class="number">${escapeHtml(formatMoney(total.grossPence, total.currency))}</td>
        <td class="number">${escapeHtml(formatMoney(total.refundPence, total.currency))}</td>
        <td class="number strong">${escapeHtml(formatMoney(total.netPence, total.currency))}</td>
        <td class="number">${total.transactionCount}</td>
        <td class="number">${total.ticketCount}</td>
      </tr>`)
    .join("");

  const tableBody = summaryRows || `
    <tr>
      <td colspan="7" class="empty">No completed paid booking sales were recorded for this period.</td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(subject)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: Arial, Helvetica, sans-serif;
        background: #f4f1eb;
        color: #273640;
      }
      .wrapper {
        padding: 32px 16px;
      }
      .card {
        max-width: 760px;
        margin: 0 auto;
        background: #ffffff;
        border-radius: 12px;
        overflow: hidden;
      }
      .header {
        background: #273640;
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
      h2 {
        margin: 0 0 12px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 24px;
      }
      p {
        margin: 0 0 16px;
        font-size: 15px;
        line-height: 1.6;
      }
      .notice {
        margin-bottom: 20px;
        padding: 12px 14px;
        border: 1px solid #d9aa6d;
        border-radius: 8px;
        background: #fff8ec;
        color: #6e3c3d;
        font-size: 14px;
        font-weight: 700;
      }
      .metric {
        margin: 20px 0;
        padding: 16px;
        border-radius: 8px;
        background: #f8f4ee;
      }
      .metric span {
        display: block;
        color: #637c8c;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .metric strong {
        display: block;
        margin-top: 4px;
        font-size: 24px;
      }
      table {
        width: 100%;
        margin: 20px 0;
        border-collapse: collapse;
        font-size: 13px;
      }
      th,
      td {
        padding: 10px 8px;
        border-bottom: 1px solid #d4d9dd;
        text-align: left;
        vertical-align: top;
      }
      th {
        color: #637c8c;
        font-size: 11px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      .number {
        text-align: right;
        white-space: nowrap;
      }
      .strong {
        font-weight: 700;
      }
      .total td {
        background: #f8f4ee;
        font-weight: 700;
      }
      .empty {
        color: #637c8c;
        text-align: center;
      }
      .footnote {
        color: #637c8c;
        font-size: 13px;
      }
      @media (max-width: 700px) {
        .wrapper {
          padding: 0;
        }
        .card {
          border-radius: 0;
        }
        .header,
        .content {
          padding-left: 20px;
          padding-right: 20px;
        }
        table {
          font-size: 12px;
        }
        th,
        td {
          padding-left: 5px;
          padding-right: 5px;
        }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="card">
        <div class="header">
          <h1>BaronsHub</h1>
          <p>Monthly sales report</p>
        </div>
        <div class="content">
          ${testNotice ? `<div class="notice">${escapeHtml(testNotice)}</div>` : ""}
          <h2>Sales report - ${escapeHtml(report.period.label)}</h2>
          <p>Hi Julie,</p>
          <p>Attached are the paid booking sales for ${escapeHtml(report.period.label)}, broken down by location so income can be allocated to the correct site.</p>
          <div class="metric">
            <span>Net sales</span>
            <strong>${escapeHtml(totalsLabel(report.totals))}</strong>
          </div>
          <table>
            <thead>
              <tr>
                <th>Location</th>
                <th>Currency</th>
                <th class="number">Gross</th>
                <th class="number">Refunds</th>
                <th class="number">Net</th>
                <th class="number">Payments</th>
                <th class="number">Tickets</th>
              </tr>
            </thead>
            <tbody>
              ${tableBody}
              ${totalsRows}
            </tbody>
          </table>
          <p>The attached summary CSV gives the location totals. The detail CSV lists each payment with event date, booking reference, location, gross sales, refunds, and net sales.</p>
          <p class="footnote">Report basis: payments completed from ${escapeHtml(formatReportDateTime(report.period.startUtcIso))} to before ${escapeHtml(formatReportDateTime(report.period.endUtcIso))} in the UK timezone. Refunds are deducted from the original payment in this report.</p>
        </div>
      </div>
    </div>
  </body>
</html>`;

  const summaryLines = report.locationSummaries.length
    ? report.locationSummaries.map((summary) =>
        `${summary.venueName}: gross ${formatMoney(summary.grossPence, summary.currency)}, refunds ${formatMoney(summary.refundPence, summary.currency)}, net ${formatMoney(summary.netPence, summary.currency)}, payments ${summary.transactionCount}, tickets ${summary.ticketCount}`
      )
    : ["No completed paid booking sales were recorded for this period."];
  const totalLines = report.totals.map((total) =>
    `Total ${total.currency}: gross ${formatMoney(total.grossPence, total.currency)}, refunds ${formatMoney(total.refundPence, total.currency)}, net ${formatMoney(total.netPence, total.currency)}, payments ${total.transactionCount}, tickets ${total.ticketCount}`
  );

  const text = [
    subject,
    "",
    testNotice,
    testNotice ? "" : "",
    "Hi Julie,",
    "",
    `Attached are the paid booking sales for ${report.period.label}, broken down by location so income can be allocated to the correct site.`,
    "",
    `Net sales: ${totalsLabel(report.totals)}`,
    "",
    "Location summary:",
    ...summaryLines,
    ...totalLines,
    "",
    "Attachments:",
    `- baronshub-sales-summary-${report.period.key}.csv`,
    `- baronshub-sales-detail-${report.period.key}.csv`,
    "",
    `Report basis: payments completed from ${formatReportDateTime(report.period.startUtcIso)} to before ${formatReportDateTime(report.period.endUtcIso)} in the UK timezone. Refunds are deducted from the original payment in this report.`,
  ].filter((line) => line !== undefined).join("\n");

  return { subject, html, text };
}
