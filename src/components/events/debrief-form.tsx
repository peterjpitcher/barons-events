"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { submitDebriefAction } from "@/actions/debriefs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";

type DebriefFormProps = {
  eventId: string;
  defaults?: {
    attendance: number | null;
    wet_takings: number | null;
    food_takings: number | null;
    promo_effectiveness: number | null;
    highlights: string | null;
    issues: string | null;
  } | null;
};

export function DebriefForm({ eventId, defaults }: DebriefFormProps) {
  const [state, formAction] = useActionState(submitDebriefAction, undefined);

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
      } else {
        toast.error(state.message);
      }
    }
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="eventId" value={eventId} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="attendance">Actual attendance</Label>
          <Input id="attendance" name="attendance" type="number" min={0} defaultValue={defaults?.attendance ?? ""} placeholder="e.g. 108" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="promoEffectiveness">Promo effectiveness (1-5)</Label>
          <Input
            id="promoEffectiveness"
            name="promoEffectiveness"
            type="number"
            min={1}
            max={5}
            defaultValue={defaults?.promo_effectiveness ?? ""}
            placeholder="e.g. 4"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wetTakings">Wet takings (£)</Label>
          <Input id="wetTakings" name="wetTakings" type="number" step="0.01" min={0} defaultValue={defaults?.wet_takings ?? ""} placeholder="e.g. 2450" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="foodTakings">Food takings (£)</Label>
          <Input id="foodTakings" name="foodTakings" type="number" step="0.01" min={0} defaultValue={defaults?.food_takings ?? ""} placeholder="e.g. 780" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="highlights">Wins</Label>
        <Textarea id="highlights" name="highlights" rows={3} defaultValue={defaults?.highlights ?? ""} placeholder="What worked well?" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="issues">Issues or learnings</Label>
        <Textarea id="issues" name="issues" rows={3} defaultValue={defaults?.issues ?? ""} placeholder="Anything to improve next time?" />
      </div>
      <SubmitButton label="Save debrief" pendingLabel="Saving..." variant="primary" />
    </form>
  );
}
