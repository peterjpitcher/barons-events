"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateBusinessSettingsAction } from "@/actions/business-settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

type BusinessSettingsManagerProps = {
  labourRateGbp: number;
  accountantSalesReportEnabled: boolean;
  accountantSalesReportEmail: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

export function BusinessSettingsManager({
  labourRateGbp,
  accountantSalesReportEnabled,
  accountantSalesReportEmail,
  updatedAt,
  updatedBy
}: BusinessSettingsManagerProps) {
  const [state, formAction] = useActionState(updateBusinessSettingsAction, undefined);

  useEffect(() => {
    if (state?.message) {
      if (state.success) toast.success(state.message);
      else toast.error(state.message);
    }
  }, [state]);

  return (
    <form action={formAction} className="max-w-xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="labourRateGbp">Labour cost (£ per hour)</Label>
        <Input
          id="labourRateGbp"
          name="labourRateGbp"
          type="number"
          step="0.01"
          min={0.01}
          max={999.99}
          defaultValue={labourRateGbp.toFixed(2)}
        />
        <p className="text-xs text-subtle">
          Used in the post-event debrief to estimate labour cost. Changes take effect on the next debrief submitted.
        </p>
      </div>

      <div className="space-y-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-4 shadow-soft">
        <div className="space-y-2">
          <Label htmlFor="accountantSalesReportEmail">Accountant sales report email</Label>
          <Input
            id="accountantSalesReportEmail"
            name="accountantSalesReportEmail"
            type="email"
            defaultValue={accountantSalesReportEmail}
            autoComplete="email"
          />
          <p className="text-xs text-subtle">
            Monthly paid booking sales are emailed on the first of each month for the previous calendar month.
          </p>
        </div>
        <label className="flex items-start gap-3 text-sm text-[var(--color-text)]">
          <input
            name="accountantSalesReportEnabled"
            type="checkbox"
            defaultChecked={accountantSalesReportEnabled}
            className="mt-1 h-4 w-4 rounded border-[var(--color-border)]"
          />
          <span>
            Send the monthly accountant sales report automatically, including months with no completed paid sales.
          </span>
        </label>
      </div>

      {updatedAt ? (
        <p className="text-xs text-subtle">
          Last updated: {new Date(updatedAt).toLocaleString("en-GB")}
          {updatedBy ? ` by ${updatedBy}` : ""}
        </p>
      ) : null}

      <SubmitButton label="Save settings" pendingLabel="Saving..." variant="primary" />
    </form>
  );
}
