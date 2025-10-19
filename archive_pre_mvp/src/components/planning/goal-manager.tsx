"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createGoalAction,
  toggleGoalStatusAction,
  type GoalFormState,
  type GoalToggleState,
} from "@/actions/goals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type GoalRecord = {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  created_at: string | null;
};

type GoalManagerProps = {
  goals: GoalRecord[];
};

const initialCreateState: GoalFormState = {};

export function GoalManager({ goals }: GoalManagerProps) {
  const [createState, createAction] = useActionState<
    GoalFormState,
    FormData
  >(async (state, formData) => (await createGoalAction(state, formData)) ?? initialCreateState, initialCreateState);

  const createDisabled = goals.length >= 25;

  return (
    <div className="space-y-6 rounded-xl border border-[rgba(42,79,168,0.18)] bg-white/95 p-6 shadow-soft">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--color-primary-900)]">Goals catalogue</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          Manage strategic goals available to venue managers during event submissions.
          Goals stay active until you archive them for future reference.
        </p>
      </header>

      <form action={createAction} className="space-y-4 rounded-lg border border-[rgba(42,79,168,0.15)] bg-[var(--color-muted-surface)] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="label" className="text-sm font-medium text-[var(--color-text)]">
              Goal name
            </label>
            <input
              id="label"
              name="label"
              required
              maxLength={120}
              disabled={createDisabled}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
            />
            {createState.fieldErrors?.label ? (
              <p className="text-xs text-[var(--color-danger)]">{createState.fieldErrors.label}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium text-[var(--color-text)]">
              Description <span className="text-xs text-[var(--color-text-subtle)]">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              maxLength={500}
              disabled={createDisabled}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
            />
            {createState.fieldErrors?.description ? (
              <p className="text-xs text-[var(--color-danger)]">
                {createState.fieldErrors.description}
              </p>
            ) : null}
          </div>
        </div>

        {createState.error ? (
          <div className="rounded-md bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm text-[var(--color-danger)]">
            {createState.error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={createDisabled}>
            Create goal
          </Button>
          <span className="text-xs text-[var(--color-text-subtle)]">
            {createDisabled
              ? "Goal limit reached. Archive inactive entries before creating new ones."
              : "Goals become immediately available to venue managers."}
          </span>
        </div>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Existing goals
          </h3>
          <span className="text-xs text-[var(--color-text-subtle)]">
            {goals.length} goal{goals.length === 1 ? "" : "s"}
          </span>
        </div>

        {goals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[rgba(42,79,168,0.25)] bg-white/95 px-3 py-3 text-sm text-[var(--color-text-muted)]">
            No goals yet. Create the first strategic focus to guide event submissions.
          </p>
        ) : (
          <ul className="space-y-2">
            {goals.map((goal) => (
              <li
                key={goal.id}
                className="flex flex-col gap-2 rounded-lg border border-[rgba(42,79,168,0.15)] bg-white/95 px-3 py-3 text-sm text-[var(--color-primary-900)] md:flex-row md:items-center md:justify-between"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[var(--color-primary-900)]">{goal.label}</span>
                    <Badge variant={goal.active ? "success" : "neutral"}>
                      {goal.active ? "Active" : "Archived"}
                    </Badge>
                  </div>
                  {goal.description ? (
                    <p className="text-xs text-[var(--color-text-muted)]">{goal.description}</p>
                  ) : null}
                </div>
                <GoalToggleForm goal={goal} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function GoalToggleForm({ goal }: { goal: GoalRecord }) {
  const [state, dispatch] = useActionState<GoalToggleState, FormData>(
    async (_, formData) =>
      (await toggleGoalStatusAction(_, formData)) ?? {},
    {}
  );

  return (
    <form action={dispatch} className="flex flex-col gap-2 md:items-end">
      <input type="hidden" name="goalId" value={goal.id} />
      <input
        type="hidden"
        name="nextActive"
        value={goal.active ? "false" : "true"}
      />
      {state?.error ? (
        <p className="text-xs text-[var(--color-danger)]">{state.error}</p>
      ) : null}
      <GoalToggleButton active={goal.active} />
    </form>
  );
}

function GoalToggleButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
    >
      {pending ? "Saving…" : active ? "Archive goal" : "Restore goal"}
    </Button>
  );
}
