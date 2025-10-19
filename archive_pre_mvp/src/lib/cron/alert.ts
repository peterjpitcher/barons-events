import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type CronAlertPayload = {
  job: string;
  message: string;
  detail?: string;
};

const getWebhookUrl = () => process.env.CRON_ALERT_WEBHOOK_URL ?? "";

type CronAlertLogInput = {
  job: string;
  severity: "error" | "info" | "success";
  message: string;
  detail?: string | null;
  responseStatus?: number | null;
  responseBody?: string | null;
};

const serializeBody = (body: unknown) => {
  if (body == null) return null;
  if (typeof body === "string") {
    return body.slice(0, 500);
  }
  try {
    return JSON.stringify(body).slice(0, 500);
  } catch {
    return "[unserializable-body]";
  }
};

const insertCronAlertLog = async (input: CronAlertLogInput) => {
  try {
    const supabase = createSupabaseServiceRoleClient();
    await supabase.from("cron_alert_logs").insert({
      job: input.job,
      severity: input.severity,
      message: input.message,
      detail: input.detail ?? null,
      response_status: input.responseStatus ?? null,
      response_body: input.responseBody ?? null,
    });
  } catch (error) {
    console.error(
      "[cron][alert] Failed to record cron alert log",
      JSON.stringify({
        job: input.job,
        severity: input.severity,
        message: input.message,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );
  }
};

export async function reportCronFailure(payload: CronAlertPayload) {
  const webhookUrl = getWebhookUrl();
  try {
    let responseStatus: number | null = null;
    let responseBody: unknown = null;

    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          timestamp: new Date().toISOString(),
        }),
      });

      responseStatus = response.status;
      const contentType = response.headers.get("content-type") ?? "";
      responseBody = contentType.includes("application/json")
        ? await response.json().catch(() => response.text())
        : await response.text();
    } else {
      responseBody = "Webhook URL not configured";
    }

    await insertCronAlertLog({
      job: payload.job,
      severity: "error",
      message: payload.message,
      detail: payload.detail ?? null,
      responseStatus,
      responseBody: serializeBody(responseBody),
    });
  } catch (error) {
    console.error(
      "[cron][alert] Failed to notify webhook",
      JSON.stringify({
        job: payload.job,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );
    await insertCronAlertLog({
      job: payload.job,
      severity: "error",
      message: payload.message,
      detail:
        payload.detail ??
        (error instanceof Error
          ? error.message
          : "Unknown webhook failure"),
      responseStatus: null,
      responseBody: serializeBody(
        error instanceof Error ? error.message : String(error)
      ),
    });
  }
}

export async function pingCronAlertWebhook(job = "webhook-ping") {
  const webhookUrl = getWebhookUrl();

  if (!webhookUrl) {
    await insertCronAlertLog({
      job,
      severity: "info",
      message: "Cron alert webhook ping skipped (not configured)",
      detail: null,
      responseStatus: null,
      responseBody: null,
    });
    return {
      ok: false,
      status: 0,
      body: "Webhook URL not configured",
    };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job,
        message: "Heartbeat ping",
        timestamp: new Date().toISOString(),
      }),
    });

    const contentType = response.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("application/json")
      ? await response.json().catch(() => response.text())
      : await response.text();

    await insertCronAlertLog({
      job,
      severity: response.ok ? "success" : "error",
      message: response.ok
        ? "Cron alert webhook heartbeat succeeded"
        : "Cron alert webhook heartbeat failed",
      detail: null,
      responseStatus: response.status,
      responseBody: serializeBody(responseBody),
    });

    return {
      ok: response.ok,
      status: response.status,
      body: typeof responseBody === "string" ? responseBody : serializeBody(responseBody),
    };
  } catch (error) {
    console.error(
      "[cron][alert] Failed to notify webhook",
      JSON.stringify({
        job,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );
    await insertCronAlertLog({
      job,
      severity: "error",
      message: "Cron alert webhook heartbeat failed to send",
      detail: error instanceof Error ? error.message : "Unknown error",
      responseStatus: null,
      responseBody: serializeBody(
        error instanceof Error ? error.message : String(error)
      ),
    });
    return {
      ok: false,
      status: 0,
      body: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
