"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  createGoalAction,
  toggleGoalStatusAction,
  type GoalFormState,
  type GoalToggleState,
} from "@/actions/goals";

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
  const [createState, createAction] = useFormState<
    GoalFormState,
    FormData
  >(async (state, formData) => (await createGoalAction(state, formData)) ?? initialCreateState, initialCreateState);

  const createDisabled = goals.length >= 25;

  return (
    <div className="space-y-6 rounded-xl border border-black/[0.08] bg-white p-6 shadow-sm">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-black">Goals catalogue</h2>
        <p className="text-sm text-black/70">
          Manage strategic goals available to venue managers during event submissions.
          Goals stay active until you archive them for future reference.
        </p>
      </header>

      <form action={createAction} className="space-y-4 rounded-lg border border-black/[0.06] bg-black/[0.02] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="label" className="text-sm font-medium text-black/80">
              Goal name
            </label>
            <input
              id="label"
              name="label"
              required
              maxLength={120}
              disabled={createDisabled}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
            />
            {createState.fieldErrors?.label ? (
              <p className="text-xs text-red-600">{createState.fieldErrors.label}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium text-black/80">
              Description <span className="text-xs text-black/40">(optional)</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={2}
              maxLength={500}
              disabled={createDisabled}
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm text-black shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
            />
            {createState.fieldErrors?.description ? (
              <p className="text-xs text-red-600">
                {createState.fieldErrors.description}
              </p>
            ) : null}
          </div>
        </div>

        {createState.error ? (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {createState.error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={createDisabled}
            className="inline-flex items-center justify-center rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-black/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
          >
            Create goal
          </button>
          <span className="text-xs text-black/50">
            {createDisabled
              ? "Goal limit reached. Archive inactive entries before creating new ones."
              : "Goals become immediately available to venue managers."}
          </span>
        </div>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-black/60">
            Existing goals
          </h3>
          <span className="text-xs text-black/50">
            {goals.length} goal{goals.length === 1 ? "" : "s"}
          </span>
        </div>

        {goals.length === 0 ? (
          <p className="rounded-lg border border-dashed border-black/20 bg-white px-3 py-3 text-sm text-black/60">
            No goals yet. Create the first strategic focus to guide event submissions.
          </p>
        ) : (
          <ul className="space-y-2">
            {goals.map((goal) => (
              <li
                key={goal.id}
                className="flex flex-col gap-2 rounded-lg border border-black/[0.06] bg-black/[0.015] px-3 py-3 text-sm text-black/80 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-black">{goal.label}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        goal.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-black/10 text-black/60"
                      }`}
                    >
                      {goal.active ? "Active" : "Archived"}
                    </span>
                  </div>
                  {goal.description ? (
                    <p className="text-xs text-black/60">{goal.description}</p>
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
  const [state, dispatch] = useFormState<GoalToggleState, FormData>(
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
        <p className="text-xs text-red-600">{state.error}</p>
      ) : null}
      <GoalToggleButton active={goal.active} />
    </form>
  );
}

function GoalToggleButton({ active }: { active: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="inline-flex items-center justify-center rounded-lg border border-black/[0.12] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-black hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40"
      disabled={pending}
    >
      {pending ? "Saving…" : active ? "Archive goal" : "Restore goal"}
    </button>
  );
}
