"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export type DebriefInitialValues = {
  actualAttendance: number | null;
  wetTakings: number | null;
  foodTakings: number | null;
  promoRating: number | null;
  wins: string | null;
  issues: string | null;
  observations: string | null;
};

export type ReminderDescriptor = {
  status: "pending" | "due" | "overdue" | "completed";
  title: string;
  description: string;
  variant: "info" | "warning" | "danger" | "success" | "neutral";
  nextStep?: string | null;
};

type DebriefFormProps = {
  eventTitle: string;
  initialValues: DebriefInitialValues;
  reminder: ReminderDescriptor;
  submittedAt: string | null;
};

type FormState = "idle" | "saving" | "saved" | "error";

const promoOptions = [
  { value: "", label: "Select rating" },
  { value: "5", label: "Excellent (5/5)" },
  { value: "4", label: "Strong (4/5)" },
  { value: "3", label: "Adequate (3/5)" },
  { value: "2", label: "Needs improvement (2/5)" },
  { value: "1", label: "Ineffective (1/5)" },
];

const numberOrEmpty = (value: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : "";

const formatTimestamp = (value: string | null) => {
  if (!value) return null;
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return null;
  }
};

export function DebriefForm({
  eventTitle,
  initialValues,
  reminder,
  submittedAt,
}: DebriefFormProps) {
  const [formState, setFormState] = useState<FormState>("idle");
  const [lastSubmittedAt, setLastSubmittedAt] = useState<string | null>(submittedAt);
  const [error, setError] = useState<string | null>(null);

  const displaySubmittedAt = useMemo(
    () => formatTimestamp(lastSubmittedAt),
    [lastSubmittedAt]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormState("saving");
    setError(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      actualAttendance: formData.get("actualAttendance"),
      wetTakings: formData.get("wetTakings"),
      foodTakings: formData.get("foodTakings"),
      promoRating: formData.get("promoRating"),
      wins: formData.get("wins"),
      issues: formData.get("issues"),
      observations: formData.get("observations"),
    };

    if (!payload.actualAttendance || Number(payload.actualAttendance) < 0) {
      setError("Attendance must be provided to complete the debrief.");
      setFormState("error");
      return;
    }

    // TODO: replace with Supabase record_debrief RPC once wired.
    await new Promise((resolve) => setTimeout(resolve, 900));

    setFormState("saved");
    setLastSubmittedAt(new Date().toISOString());
    setTimeout(() => setFormState("idle"), 2500);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Alert variant={reminder.variant} title={reminder.title}>
        <p className="mt-1 text-[0.95rem] leading-relaxed text-[var(--color-primary-800)]">
          {reminder.description}
        </p>
        {reminder.nextStep ? (
          <p className="mt-1 text-xs uppercase tracking-wide text-black/55">
            Next step: {reminder.nextStep}
          </p>
        ) : null}
      </Alert>

      {error ? <Alert variant="danger" title={error} /> : null}
      {formState === "saved" ? (
        <Alert
          variant="success"
          title="Debrief saved"
          description={
            displaySubmittedAt
              ? `We recorded updates to the ${eventTitle} debrief at ${displaySubmittedAt}.`
              : "We recorded updates to this debrief."
          }
        />
      ) : null}

      <section className="space-y-4 rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.08)] bg-white/90 p-6 shadow-soft">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-[var(--color-primary-900)]">
            Performance snapshot
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            Capture actual figures so central planning can compare plan versus reality and keep the
            executive digest aligned.
          </p>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <label
              htmlFor="actualAttendance"
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Actual attendance
            </label>
            <Input
              id="actualAttendance"
              name="actualAttendance"
              type="number"
              min={0}
              inputMode="numeric"
              defaultValue={numberOrEmpty(initialValues.actualAttendance)}
              placeholder="145"
              aria-describedby="actualAttendance-help"
            />
            <HelperText id="actualAttendance-help">
              Count unique attendees scanned or confirmed on the night.
            </HelperText>
          </Field>

          <Field>
            <label
              htmlFor="promoRating"
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Promo effectiveness
            </label>
            <Select
              id="promoRating"
              name="promoRating"
              defaultValue={numberOrEmpty(initialValues.promoRating)}
              aria-describedby="promoRating-help"
            >
              {promoOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <HelperText id="promoRating-help">
              Rate how the promotions performed against expectations.
            </HelperText>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <label
              htmlFor="wetTakings"
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Wet takings (£)
            </label>
            <Input
              id="wetTakings"
              name="wetTakings"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={numberOrEmpty(initialValues.wetTakings)}
              placeholder="3560.45"
            />
            <HelperText>
              Enter gross beverage sales for the event’s duration.
            </HelperText>
          </Field>

          <Field>
            <label
              htmlFor="foodTakings"
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Food takings (£)
            </label>
            <Input
              id="foodTakings"
              name="foodTakings"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={numberOrEmpty(initialValues.foodTakings)}
              placeholder="1280.90"
            />
            <HelperText>
              Include any pop-up or pre-order catering tied to this event.
            </HelperText>
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.08)] bg-white/95 p-6 shadow-soft">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-[var(--color-primary-900)]">
            Observations & follow-ups
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            Share the context central planning needs for follow-up planning, repeat bookings, or issue
            remediation.
          </p>
        </header>
        <div className="space-y-4">
          <Field>
            <label
              htmlFor="wins"
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Standout wins
            </label>
            <Textarea
              id="wins"
              name="wins"
              rows={3}
              placeholder="Promo bundle sold out before midnight; VIP lounge upsell succeeded."
              defaultValue={initialValues.wins ?? ""}
            />
          </Field>

          <Field>
            <label
              htmlFor="issues"
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Issues to watch
            </label>
            <Textarea
              id="issues"
              name="issues"
              rows={3}
              placeholder="Need more bar staff from 22:00; ticket scanner stalled at opening."
              defaultValue={initialValues.issues ?? ""}
            />
          </Field>

          <Field>
            <label
              htmlFor="observations"
              className="text-xs font-semibold uppercase tracking-[0.25em] text-subtle"
            >
              Additional observations
            </label>
            <Textarea
              id="observations"
              name="observations"
              rows={4}
              placeholder="Weather pushed walk-ins later; DJ swap kept the crowd through close."
              defaultValue={initialValues.observations ?? ""}
            />
            <HelperText>
              Include media context (e.g. key clips or social performance) or any central-planning follow-ups.
            </HelperText>
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-[var(--radius-lg)] border border-dashed border-[rgba(39,54,64,0.16)] bg-white/60 p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-[var(--color-primary-900)]">
            Media & receipts
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            Drop photos, recap decks, or till Z reports so reviewers have everything for the weekly
            digest. File uploads land in Supabase Storage.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 rounded-[var(--radius)] bg-[rgba(39,54,64,0.08)]" />
          <Skeleton className="h-24 rounded-[var(--radius)] bg-[rgba(39,54,64,0.08)]" />
        </div>
        <Button type="button" variant="outline" className="w-full sm:w-auto">
          Upload files (coming soon)
        </Button>
        <p className="text-xs text-muted">
          Attachments are optional today; follow the runbook if manual upload is needed.
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={formState === "saving"}>
          {formState === "saving" ? "Saving…" : "Submit debrief"}
        </Button>
        <span className="text-xs text-muted">
          We’ll send you a confirmation email once the debrief is stored.
        </span>
      </div>
    </form>
  );
}

type FieldProps = {
  children: ReactNode;
};

function Field({ children }: FieldProps) {
  return <div className="space-y-2">{children}</div>;
}

type HelperTextProps = {
  id?: string;
  children: ReactNode;
};

function HelperText({ id, children }: HelperTextProps) {
  return (
    <p id={id} className="text-xs text-muted leading-relaxed">
      {children}
    </p>
  );
}
