import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import {
  buildMonthlySalesReportAttachments,
  buildMonthlySalesReportDetailCsv,
  buildMonthlySalesReportSummaryCsv,
  buildSalesReportFromPaymentRows,
  createSampleMonthlySalesReport,
  getPreviousSalesReportPeriod,
  getSalesReportPeriodForMonth,
  renderMonthlySalesReportEmail,
} from "@/lib/monthly-sales-report";

const period = getSalesReportPeriodForMonth("2026-04");

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-1",
    booking_id: "booking-1",
    event_id: "event-1",
    stripe_checkout_session_id: "cs_test_1",
    amount_pence: 1500,
    refunded_amount_pence: 0,
    currency: "gbp",
    status: "completed",
    completed_at: "2026-04-12T12:30:00.000Z",
    booking: { id: "booking-1", ticket_count: 2 },
    event: {
      id: "event-1",
      title: "Jazz Night",
      public_title: "Jazz Night",
      start_at: "2026-04-19T18:30:00.000Z",
      venue_id: "venue-1",
      venue: { id: "venue-1", name: "The Duke" },
    },
    ...overrides,
  };
}

describe("monthly sales report", () => {
  it("resolves a London calendar month to UTC query boundaries", () => {
    expect(period).toMatchObject({
      key: "2026-04",
      label: "April 2026",
      startUtcIso: "2026-03-31T23:00:00.000Z",
      endUtcIso: "2026-04-30T23:00:00.000Z",
    });
  });

  it("uses the previous London calendar month by default", () => {
    const previous = getPreviousSalesReportPeriod(new Date("2026-01-15T10:00:00.000Z"));
    expect(previous).toMatchObject({
      key: "2025-12",
      label: "December 2025",
      startUtcIso: "2025-12-01T00:00:00.000Z",
      endUtcIso: "2026-01-01T00:00:00.000Z",
    });
  });

  it("aggregates completed, partially refunded, and refunded payments by location", () => {
    const report = buildSalesReportFromPaymentRows(period, [
      paymentRow(),
      paymentRow({
        id: "tx-2",
        booking_id: "booking-2",
        amount_pence: 2000,
        refunded_amount_pence: 500,
        status: "partially_refunded",
        completed_at: "2026-04-14T10:00:00.000Z",
        booking: { id: "booking-2", ticket_count: 3 },
        event: {
          id: "event-2",
          title: "Quiz Night",
          public_title: null,
          start_at: "2026-04-21T18:30:00.000Z",
          venue_id: "venue-2",
          venue: { id: "venue-2", name: "Barons Cross" },
        },
      }),
      paymentRow({
        id: "tx-3",
        booking_id: "booking-3",
        amount_pence: 1000,
        refunded_amount_pence: 1000,
        status: "refunded",
        completed_at: "2026-04-15T10:00:00.000Z",
        booking: { id: "booking-3", ticket_count: 1 },
        event: {
          id: "event-3",
          title: "Cancelled Supper",
          public_title: null,
          start_at: "2026-04-22T18:30:00.000Z",
          venue_id: "venue-2",
          venue: { id: "venue-2", name: "Barons Cross" },
        },
      }),
      paymentRow({ id: "failed", status: "failed" }),
      paymentRow({ id: "pending", status: "completed", completed_at: null }),
    ]);

    expect(report.lineItems).toHaveLength(3);
    expect(report.locationSummaries).toEqual([
      {
        venueId: "venue-2",
        venueName: "Barons Cross",
        currency: "GBP",
        grossPence: 3000,
        refundPence: 1500,
        netPence: 1500,
        transactionCount: 2,
        ticketCount: 4,
      },
      {
        venueId: "venue-1",
        venueName: "The Duke",
        currency: "GBP",
        grossPence: 1500,
        refundPence: 0,
        netPence: 1500,
        transactionCount: 1,
        ticketCount: 2,
      },
    ]);
    expect(report.totals).toEqual([
      {
        currency: "GBP",
        grossPence: 4500,
        refundPence: 1500,
        netPence: 3000,
        transactionCount: 3,
        ticketCount: 6,
      },
    ]);
  });

  it("renders accountant-facing email copy and CSV attachments", () => {
    const report = buildSalesReportFromPaymentRows(period, [
      paymentRow({
        event: {
          id: "event-1",
          title: "Jazz Night, Early Show",
          public_title: null,
          start_at: "2026-04-19T18:30:00.000Z",
          venue_id: "venue-1",
          venue: { id: "venue-1", name: "The Duke" },
        },
      }),
    ]);

    const email = renderMonthlySalesReportEmail(report, {
      testMode: true,
      testRecipientEmail: "peter@orangejelly.co.uk",
    });
    const summaryCsv = buildMonthlySalesReportSummaryCsv(report);
    const detailCsv = buildMonthlySalesReportDetailCsv(report);
    const attachments = buildMonthlySalesReportAttachments(report);

    expect(email.subject).toBe("[TEST] BaronsHub sales report - April 2026");
    expect(email.text).toContain("Hi Julie,");
    expect(email.text).toContain("Julie has not been emailed.");
    expect(email.text).toContain("The Duke: gross");
    expect(email.html).toContain("Monthly sales report");
    expect(summaryCsv).toContain("Location,Currency,Gross sales,Refunds,Net sales,Transactions,Tickets");
    expect(detailCsv).toContain("\"Jazz Night, Early Show\"");
    expect(attachments.map((attachment) => attachment.filename)).toEqual([
      "baronshub-sales-summary-2026-04.csv",
      "baronshub-sales-detail-2026-04.csv",
    ]);
  });

  it("creates a realistic sample report without database rows", () => {
    const report = createSampleMonthlySalesReport(period);
    const email = renderMonthlySalesReportEmail(report, {
      testMode: true,
      testRecipientEmail: "peter@orangejelly.co.uk",
    });

    expect(report.lineItems).toHaveLength(6);
    expect(report.locationSummaries.map((summary) => summary.venueName)).toEqual([
      "Barons Cross",
      "The Cricketers",
      "The Duke",
    ]);
    expect(report.totals).toEqual([
      {
        currency: "GBP",
        grossPence: 25100,
        refundPence: 4200,
        netPence: 20900,
        transactionCount: 6,
        ticketCount: 24,
      },
    ]);
    expect(email.text).toContain("Net sales: £209.00");
    expect(email.text).toContain("Barons Cross: gross £70.00, refunds £30.00, net £40.00");
  });
});
