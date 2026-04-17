"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateBusinessSettingsAction } from "@/actions/business-settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

type BusinessSettingsManagerProps = {
  labourRateGbp: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

export function BusinessSettingsManager({
  labourRateGbp,
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
    <form action={formAction} className="max-w-md space-y-4">
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
        {updatedAt ? (
          <p className="text-xs text-subtle">
            Last updated: {new Date(updatedAt).toLocaleString("en-GB")}
            {updatedBy ? ` by ${updatedBy}` : ""}
          </p>
        ) : null}
      </div>
      <SubmitButton label="Save rate" pendingLabel="Saving..." variant="primary" />
    </form>
  );
}
