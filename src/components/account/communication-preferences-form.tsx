"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateCommunicationPreferencesAction } from "@/actions/account";
import {
  TODO_DIGEST_FREQUENCIES,
  TODO_DIGEST_FREQUENCY_DESCRIPTIONS,
  TODO_DIGEST_FREQUENCY_LABELS,
  type TodoDigestFrequency,
} from "@/lib/communication-preferences";
import { FieldError } from "@/components/ui/field-error";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";

type CommunicationPreferencesFormProps = {
  todoDigestFrequency: TodoDigestFrequency;
  todoDigestLastSentOn: string | null;
};

export function CommunicationPreferencesForm({
  todoDigestFrequency,
  todoDigestLastSentOn,
}: CommunicationPreferencesFormProps) {
  const [state, formAction] = useActionState(updateCommunicationPreferencesAction, undefined);
  const frequencyError = state?.fieldErrors?.todoDigestFrequency;

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="todoDigestFrequency">Todo digest email</Label>
        <Select
          id="todoDigestFrequency"
          name="todoDigestFrequency"
          defaultValue={todoDigestFrequency}
          className="h-12 text-[16px] md:h-10 md:text-sm"
          aria-invalid={Boolean(frequencyError)}
          aria-describedby={frequencyError ? "todo-digest-frequency-error" : undefined}
        >
          {TODO_DIGEST_FREQUENCIES.map((frequency) => (
            <option key={frequency} value={frequency}>
              {TODO_DIGEST_FREQUENCY_LABELS[frequency]} - {TODO_DIGEST_FREQUENCY_DESCRIPTIONS[frequency]}
            </option>
          ))}
        </Select>
        <FieldError id="todo-digest-frequency-error" message={frequencyError} />
      </div>

      {todoDigestLastSentOn ? (
        <p className="text-xs text-subtle">
          Last todo digest sent on {new Date(`${todoDigestLastSentOn}T00:00:00Z`).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            timeZone: "UTC",
          })}
        </p>
      ) : null}

      <SubmitButton label="Save preferences" pendingLabel="Saving..." variant="primary" className="h-11 w-full md:w-auto" />
    </form>
  );
}
