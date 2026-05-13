"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditLogEntry } from "@/lib/audit-log";
import type { ActionResult } from "@/lib/types";

const updateSettingsSchema = z.object({
  labourRateGbp: z.coerce
    .number()
    .positive("Rate must be greater than zero")
    .max(999.99, "Rate must be £999.99 or less"),
  accountantSalesReportEnabled: z.preprocess(
    (value) => value === "on" || value === "true",
    z.boolean()
  ),
  accountantSalesReportEmail: z.string()
    .trim()
    .toLowerCase()
    .email({ message: "Use a valid accountant email address." })
});

export async function updateBusinessSettingsAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: "You must be signed in." };
  if (user.role !== "administrator") {
    return {
      success: false,
      message: "Only administrators can change business settings."
    };
  }

  const parsed = updateSettingsSchema.safeParse({
    labourRateGbp: formData.get("labourRateGbp"),
    accountantSalesReportEnabled: formData.get("accountantSalesReportEnabled"),
    accountantSalesReportEmail: formData.get("accountantSalesReportEmail")
  });
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Check the highlighted field."
    };
  }

  const db = createSupabaseAdminClient();

   
  const { data: before } = await (db as any)
    .from("business_settings")
    .select("labour_rate_gbp, accountant_sales_report_enabled, accountant_sales_report_email")
    .eq("id", true)
    .maybeSingle();
  const oldValue = before?.labour_rate_gbp ?? null;
  const oldReportEnabled = before?.accountant_sales_report_enabled ?? null;
  const oldReportEmail = before?.accountant_sales_report_email ?? null;

  const changedFields = [
    oldValue !== parsed.data.labourRateGbp ? "labour_rate_gbp" : null,
    oldReportEnabled !== parsed.data.accountantSalesReportEnabled ? "accountant_sales_report_enabled" : null,
    oldReportEmail !== parsed.data.accountantSalesReportEmail ? "accountant_sales_report_email" : null,
  ].filter((field): field is string => field !== null);

   
  const { error } = await (db as any)
    .from("business_settings")
    .update({
      labour_rate_gbp: parsed.data.labourRateGbp,
      accountant_sales_report_enabled: parsed.data.accountantSalesReportEnabled,
      accountant_sales_report_email: parsed.data.accountantSalesReportEmail,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", true);

  if (error) {
    console.error("updateBusinessSettingsAction failed:", error);
    return { success: false, message: "Could not update settings." };
  }

  await recordAuditLogEntry({
    entity: "business_settings",
    entityId: "singleton",
    action: "business_settings.updated",
    actorId: user.id,
    meta: {
      changed_fields: changedFields,
      labour_rate_gbp: {
        old_value: oldValue,
        new_value: parsed.data.labourRateGbp
      },
      accountant_sales_report_enabled: {
        old_value: oldReportEnabled,
        new_value: parsed.data.accountantSalesReportEnabled
      },
      accountant_sales_report_email: {
        old_value: oldReportEmail,
        new_value: parsed.data.accountantSalesReportEmail
      }
    }
  });

  revalidatePath("/settings");
  return { success: true, message: "Business settings updated." };
}
