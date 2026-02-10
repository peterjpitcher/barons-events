"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { submitDebriefAction } from "@/actions/debriefs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";

type DebriefFormProps = {
  eventId: string;
  defaults?: {
    attendance: number | null;
    baseline_attendance: number | null;
    wet_takings: number | null;
    food_takings: number | null;
    baseline_wet_takings: number | null;
    baseline_food_takings: number | null;
    promo_effectiveness: number | null;
    highlights: string | null;
    issues: string | null;
    guest_sentiment_notes: string | null;
    operational_notes: string | null;
    would_book_again: boolean | null;
    next_time_actions: string | null;
  } | null;
};

function asNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
}

export function DebriefForm({ eventId, defaults }: DebriefFormProps) {
  const [state, formAction] = useActionState(submitDebriefAction, undefined);
  const [eventWetTakings, setEventWetTakings] = useState(defaults?.wet_takings != null ? String(defaults.wet_takings) : "");
  const [eventFoodTakings, setEventFoodTakings] = useState(defaults?.food_takings != null ? String(defaults.food_takings) : "");
  const [baselineWetTakings, setBaselineWetTakings] = useState(
    defaults?.baseline_wet_takings != null ? String(defaults.baseline_wet_takings) : ""
  );
  const [baselineFoodTakings, setBaselineFoodTakings] = useState(
    defaults?.baseline_food_takings != null ? String(defaults.baseline_food_takings) : ""
  );

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
      } else {
        toast.error(state.message);
      }
    }
  }, [state]);

  const uplift = useMemo(() => {
    const eventWet = asNumber(eventWetTakings);
    const eventFood = asNumber(eventFoodTakings);
    const baselineWet = asNumber(baselineWetTakings);
    const baselineFood = asNumber(baselineFoodTakings);
    const eventTotal = (eventWet ?? 0) + (eventFood ?? 0);
    const baselineTotal = (baselineWet ?? 0) + (baselineFood ?? 0);

    const hasEventData = eventWet !== null || eventFood !== null;
    const hasBaselineData = baselineWet !== null || baselineFood !== null;
    if (!hasEventData && !hasBaselineData) {
      return {
        eventTotal: null,
        baselineTotal: null,
        upliftValue: null,
        upliftPercent: null
      };
    }

    const upliftValue = eventTotal - baselineTotal;
    const upliftPercent = baselineTotal > 0 ? (upliftValue / baselineTotal) * 100 : null;
    return {
      eventTotal,
      baselineTotal,
      upliftValue,
      upliftPercent
    };
  }, [eventWetTakings, eventFoodTakings, baselineWetTakings, baselineFoodTakings]);

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="eventId" value={eventId} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="attendance">How many people attended?</Label>
          <Input id="attendance" name="attendance" type="number" min={0} defaultValue={defaults?.attendance ?? ""} placeholder="e.g. 108" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baselineAttendance">What would attendance normally be for this day?</Label>
          <Input
            id="baselineAttendance"
            name="baselineAttendance"
            type="number"
            min={0}
            defaultValue={defaults?.baseline_attendance ?? ""}
            placeholder="e.g. 72"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wetTakings">Wet takings for this event (£)</Label>
          <Input
            id="wetTakings"
            name="wetTakings"
            type="number"
            step="0.01"
            min={0}
            value={eventWetTakings}
            onChange={(event) => setEventWetTakings(event.target.value)}
            placeholder="e.g. 2450"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="foodTakings">Food takings for this event (£)</Label>
          <Input
            id="foodTakings"
            name="foodTakings"
            type="number"
            step="0.01"
            min={0}
            value={eventFoodTakings}
            onChange={(event) => setEventFoodTakings(event.target.value)}
            placeholder="e.g. 780"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="baselineWetTakings">Normal wet takings for this day (£)</Label>
          <Input
            id="baselineWetTakings"
            name="baselineWetTakings"
            type="number"
            step="0.01"
            min={0}
            value={baselineWetTakings}
            onChange={(event) => setBaselineWetTakings(event.target.value)}
            placeholder="e.g. 1900"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baselineFoodTakings">Normal food takings for this day (£)</Label>
          <Input
            id="baselineFoodTakings"
            name="baselineFoodTakings"
            type="number"
            step="0.01"
            min={0}
            value={baselineFoodTakings}
            onChange={(event) => setBaselineFoodTakings(event.target.value)}
            placeholder="e.g. 620"
          />
        </div>
      </div>

      <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-4 text-sm">
        <p className="font-semibold text-[var(--color-text)]">Automatic uplift calculation</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <p>
            <span className="font-medium text-[var(--color-text)]">Event total:</span> {formatCurrency(uplift.eventTotal)}
          </p>
          <p>
            <span className="font-medium text-[var(--color-text)]">Baseline total:</span> {formatCurrency(uplift.baselineTotal)}
          </p>
          <p>
            <span className="font-medium text-[var(--color-text)]">Sales uplift:</span> {formatCurrency(uplift.upliftValue)}
          </p>
          <p>
            <span className="font-medium text-[var(--color-text)]">Uplift %:</span> {formatPercent(uplift.upliftPercent)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="promoEffectiveness">How effective was the promotion? (1-5)</Label>
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
          <Label htmlFor="wouldBookAgain">Would you book this artist again?</Label>
          <Select
            id="wouldBookAgain"
            name="wouldBookAgain"
            defaultValue={
              defaults?.would_book_again == null ? "" : defaults.would_book_again ? "yes" : "no"
            }
          >
            <option value="">Not answered</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="highlights">What worked well?</Label>
        <Textarea
          id="highlights"
          name="highlights"
          rows={3}
          defaultValue={defaults?.highlights ?? ""}
          placeholder="What drove strong guest response, sales, or operational wins?"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="issues">What did not go to plan?</Label>
        <Textarea
          id="issues"
          name="issues"
          rows={3}
          defaultValue={defaults?.issues ?? ""}
          placeholder="Operational gaps, timing issues, audience mismatch, etc."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="guestSentimentNotes">Guest sentiment summary</Label>
        <Textarea
          id="guestSentimentNotes"
          name="guestSentimentNotes"
          rows={3}
          defaultValue={defaults?.guest_sentiment_notes ?? ""}
          placeholder="What did guests say in person, online, or through team feedback?"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="operationalNotes">Operational notes</Label>
        <Textarea
          id="operationalNotes"
          name="operationalNotes"
          rows={3}
          defaultValue={defaults?.operational_notes ?? ""}
          placeholder="Staffing, stock, service pace, door/check-in flow, or setup notes."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="nextTimeActions">What should we do next time?</Label>
        <Textarea
          id="nextTimeActions"
          name="nextTimeActions"
          rows={3}
          defaultValue={defaults?.next_time_actions ?? ""}
          placeholder="Specific actions to repeat, stop, or test next time."
        />
      </div>

      <SubmitButton label="Save debrief" pendingLabel="Saving..." variant="primary" />
    </form>
  );
}
