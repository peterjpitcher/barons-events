import "server-only";
import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import {
  buildMonthlySalesReportAttachments,
  createSampleMonthlySalesReport,
  fetchMonthlySalesReport,
  fetchMonthlySalesReportSettings,
  getPreviousSalesReportPeriod,
  getSalesReportPeriodForMonth,
  hasMonthlySalesReportBeenSent,
  recordMonthlySalesReportSent,
  renderMonthlySalesReportEmail,
} from "@/lib/monthly-sales-report";
import { sendMonthlySalesReportEmail } from "@/lib/notifications";

const LOCAL_TEST_RECIPIENT = "peter@orangejelly.co.uk";

function resolvePeriod(request: Request) {
  const url = new URL(request.url);
  const periodParam = url.searchParams.get("period");
  return periodParam ? getSalesReportPeriodForMonth(periodParam) : getPreviousSalesReportPeriod();
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const sample = url.searchParams.get("sample") === "1";
    const htmlPreview = url.searchParams.get("preview") === "html";
    const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("preview") === "json";
    const sendSample = sample && url.searchParams.get("send") === "1";
    const shouldSend = !htmlPreview && !dryRun && (!sample || sendSample);
    const period = resolvePeriod(request);

    console.log(JSON.stringify({
      event: "cron.invoked",
      endpoint: "monthly-sales-report",
      period: period.key,
      send: shouldSend,
      sample,
      timestamp: new Date().toISOString(),
    }));

    const report = sample ? createSampleMonthlySalesReport(period) : await fetchMonthlySalesReport(period);
    const settings = sample
      ? { enabled: true, recipientEmail: LOCAL_TEST_RECIPIENT }
      : await fetchMonthlySalesReportSettings();
    const recipientEmail = sample ? LOCAL_TEST_RECIPIENT : settings.recipientEmail;

    const email = renderMonthlySalesReportEmail(report, {
      testMode: sample,
      testRecipientEmail: sample ? LOCAL_TEST_RECIPIENT : undefined,
    });

    if (htmlPreview) {
      return new NextResponse(email.html, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-report-period": period.key,
        },
      });
    }

    if (!shouldSend) {
      return NextResponse.json({
        success: true,
        mode: sample ? "sample-preview" : "preview",
        sample,
        recipientEmail,
        period: {
          key: report.period.key,
          label: report.period.label,
          startUtcIso: report.period.startUtcIso,
          endUtcIso: report.period.endUtcIso,
        },
        subject: email.subject,
        text: email.text,
        totals: report.totals,
        locationSummaries: report.locationSummaries,
        transactionCount: report.lineItems.length,
        attachments: buildMonthlySalesReportAttachments(report).map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          bytes: attachment.content.byteLength,
        })),
      });
    }

    if (!settings.enabled) {
      return NextResponse.json({
        success: true,
        mode: "skipped",
        sample,
        skippedReason: "monthly_sales_report_disabled",
        reportMonth: period.key,
      });
    }

    if (!recipientEmail) {
      return NextResponse.json(
        {
          success: false,
          error: "Monthly sales report recipient email is not configured.",
          reportMonth: period.key,
        },
        { status: 500 }
      );
    }

    if (!sample && await hasMonthlySalesReportBeenSent(period)) {
      return NextResponse.json({
        success: true,
        mode: "skipped",
        sample,
        skippedReason: "already_sent",
        reportMonth: period.key,
      });
    }

    const result = await sendMonthlySalesReportEmail({
      report,
      recipientEmail,
      testMode: sample,
    });

    if (!result.sent) {
      return NextResponse.json(
        { success: false, mode: "send-failed", sample, ...result },
        { status: 500 }
      );
    }

    if (!sample) {
      await recordMonthlySalesReportSent({ report, recipientEmail });
    }

    console.log(JSON.stringify({
      event: "cron.completed",
      endpoint: "monthly-sales-report",
      ...result,
      timestamp: new Date().toISOString(),
    }));

    return NextResponse.json({ success: true, mode: sample ? "sample-test-send" : "sent", sample, ...result });
  } catch (error) {
    console.error("cron/monthly-sales-report: failed", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export const POST = GET;
