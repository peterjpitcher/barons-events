"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Repeat } from "lucide-react";
import { createPlanningItemAction, createPlanningSeriesAction } from "@/actions/planning";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PlanningPerson, PlanningVenueOption, RecurrenceFrequency } from "@/lib/planning/types";

type PlanningItemEditorProps = {
  today: string;
  users: PlanningPerson[];
  venues: PlanningVenueOption[];
  onChanged: () => void;
};

type TemplateRow = {
  id: string;
  title: string;
  assigneeId: string;
  dueOffsetDays: string;
};

const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" }
];

function createTemplateRow(): TemplateRow {
  return {
    id: Math.random().toString(36).slice(2),
    title: "",
    assigneeId: "",
    dueOffsetDays: "0"
  };
}

export function PlanningItemEditor({ today, users, venues, onChanged }: PlanningItemEditorProps) {
  const [mode, setMode] = useState<"single" | "series">("single");
  const [isPending, startTransition] = useTransition();

  const sortedUsers = useMemo(
    () => [...users].sort((left, right) => left.name.localeCompare(right.name)),
    [users]
  );

  const [itemTitle, setItemTitle] = useState("");
  const [itemType, setItemType] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemVenueId, setItemVenueId] = useState("");
  const [itemOwnerId, setItemOwnerId] = useState("");
  const [itemTargetDate, setItemTargetDate] = useState(today);

  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesType, setSeriesType] = useState("");
  const [seriesDescription, setSeriesDescription] = useState("");
  const [seriesVenueId, setSeriesVenueId] = useState("");
  const [seriesOwnerId, setSeriesOwnerId] = useState("");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekly");
  const [interval, setInterval] = useState("1");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthday, setMonthday] = useState("1");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState("");
  const [templates, setTemplates] = useState<TemplateRow[]>([createTemplateRow()]);

  function runAction<T>(work: () => Promise<T>, successMessage: string) {
    startTransition(async () => {
      const result: unknown = await work();
      if (result && typeof result === "object" && "success" in result && !(result as { success: boolean }).success) {
        toast.error((result as { message?: string }).message ?? "Could not save planning data.");
        return;
      }

      toast.success(successMessage);
      onChanged();
    });
  }

  function resetSingleForm() {
    setItemTitle("");
    setItemType("");
    setItemDescription("");
    setItemVenueId("");
    setItemOwnerId("");
    setItemTargetDate(today);
  }

  function resetSeriesForm() {
    setSeriesTitle("");
    setSeriesType("");
    setSeriesDescription("");
    setSeriesVenueId("");
    setSeriesOwnerId("");
    setFrequency("weekly");
    setInterval("1");
    setWeekdays([1]);
    setMonthday("1");
    setStartsOn(today);
    setEndsOn("");
    setTemplates([createTemplateRow()]);
  }

  function submitSingleItem() {
    if (!itemTitle.trim() || !itemType.trim() || !itemTargetDate) {
      toast.error("Add title, planning type, and target date.");
      return;
    }

    runAction(
      () =>
        createPlanningItemAction({
          title: itemTitle,
          typeLabel: itemType,
          description: itemDescription,
          venueId: itemVenueId,
          ownerId: itemOwnerId,
          targetDate: itemTargetDate,
          status: "planned"
        }),
      "Planning item created."
    );

    resetSingleForm();
  }

  function toggleWeekday(dayValue: number, checked: boolean) {
    setWeekdays((current) => {
      if (checked) {
        if (current.includes(dayValue)) return current;
        return [...current, dayValue].sort((left, right) => left - right);
      }
      return current.filter((value) => value !== dayValue);
    });
  }

  function submitSeries() {
    if (!seriesTitle.trim() || !seriesType.trim() || !startsOn) {
      toast.error("Add series title, planning type, and start date.");
      return;
    }

    const recurrenceInterval = Number(interval);
    if (!Number.isInteger(recurrenceInterval) || recurrenceInterval < 1) {
      toast.error("Recurrence interval must be a whole number.");
      return;
    }

    const parsedMonthday = Number(monthday);
    const templatePayload = templates
      .map((template, index) => ({
        title: template.title.trim(),
        defaultAssigneeId: template.assigneeId,
        dueOffsetDays: Number(template.dueOffsetDays || "0"),
        sortOrder: index
      }))
      .filter((template) => template.title.length > 0);

    runAction(
      () =>
        createPlanningSeriesAction({
          title: seriesTitle,
          typeLabel: seriesType,
          description: seriesDescription,
          venueId: seriesVenueId,
          ownerId: seriesOwnerId,
          recurrenceFrequency: frequency,
          recurrenceInterval,
          recurrenceWeekdays: frequency === "weekly" ? weekdays : null,
          recurrenceMonthday: frequency === "monthly" ? parsedMonthday : null,
          startsOn,
          endsOn: endsOn || null,
          taskTemplates: templatePayload
        }),
      "Recurring series created."
    );

    resetSeriesForm();
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div>
          <CardTitle>Create planning work</CardTitle>
          <CardDescription>
            Add one-off operational actions or recurring planning templates.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={mode === "single" ? "primary" : "ghost"} size="sm" onClick={() => setMode("single")}>
            Single item
          </Button>
          <Button type="button" variant={mode === "series" ? "primary" : "ghost"} size="sm" onClick={() => setMode("series")}>
            Recurring series
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "single" ? (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="planning-item-title">Title</Label>
                <Input
                  id="planning-item-title"
                  value={itemTitle}
                  maxLength={160}
                  disabled={isPending}
                  onChange={(event) => setItemTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-item-type">Planning type</Label>
                <Input
                  id="planning-item-type"
                  value={itemType}
                  maxLength={120}
                  placeholder="Menu launch, ops change, etc."
                  disabled={isPending}
                  onChange={(event) => setItemType(event.target.value)}
                />
              </div>
            </div>
            <Textarea
              value={itemDescription}
              rows={3}
              maxLength={2000}
              placeholder="Optional context"
              disabled={isPending}
              onChange={(event) => setItemDescription(event.target.value)}
            />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="planning-item-target">Target date</Label>
                <Input
                  id="planning-item-target"
                  type="date"
                  value={itemTargetDate}
                  disabled={isPending}
                  onChange={(event) => setItemTargetDate(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-item-owner">Owner</Label>
                <Select id="planning-item-owner" value={itemOwnerId} disabled={isPending} onChange={(event) => setItemOwnerId(event.target.value)}>
                  <option value="">Unassigned</option>
                  {sortedUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-item-venue">Venue</Label>
                <Select id="planning-item-venue" value={itemVenueId} disabled={isPending} onChange={(event) => setItemVenueId(event.target.value)}>
                  <option value="">Global</option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button type="button" disabled={isPending} onClick={submitSingleItem}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add planning item
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="planning-series-title">Series title</Label>
                <Input
                  id="planning-series-title"
                  value={seriesTitle}
                  maxLength={160}
                  disabled={isPending}
                  onChange={(event) => setSeriesTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-series-type">Planning type</Label>
                <Input
                  id="planning-series-type"
                  value={seriesType}
                  maxLength={120}
                  placeholder="Menu launch, ops change, etc."
                  disabled={isPending}
                  onChange={(event) => setSeriesType(event.target.value)}
                />
              </div>
            </div>
            <Textarea
              value={seriesDescription}
              rows={3}
              maxLength={2000}
              placeholder="Optional context"
              disabled={isPending}
              onChange={(event) => setSeriesDescription(event.target.value)}
            />
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="planning-series-frequency">Frequency</Label>
                <Select
                  id="planning-series-frequency"
                  value={frequency}
                  disabled={isPending}
                  onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-series-interval">Every</Label>
                <Input
                  id="planning-series-interval"
                  type="number"
                  min={1}
                  max={365}
                  value={interval}
                  disabled={isPending}
                  onChange={(event) => setInterval(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-series-start">Starts on</Label>
                <Input
                  id="planning-series-start"
                  type="date"
                  value={startsOn}
                  disabled={isPending}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-series-end">Ends on (optional)</Label>
                <Input
                  id="planning-series-end"
                  type="date"
                  value={endsOn}
                  disabled={isPending}
                  onChange={(event) => setEndsOn(event.target.value)}
                />
              </div>
            </div>

            {frequency === "weekly" ? (
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">Weekdays</legend>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_OPTIONS.map((weekday) => (
                    <label key={weekday.value} className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        checked={weekdays.includes(weekday.value)}
                        disabled={isPending}
                        onChange={(event) => toggleWeekday(weekday.value, event.target.checked)}
                      />
                      {weekday.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {frequency === "monthly" ? (
              <div className="space-y-1">
                <Label htmlFor="planning-series-monthday">Day of month</Label>
                <Input
                  id="planning-series-monthday"
                  type="number"
                  min={1}
                  max={31}
                  value={monthday}
                  disabled={isPending}
                  onChange={(event) => setMonthday(event.target.value)}
                />
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="planning-series-owner">Owner</Label>
                <Select
                  id="planning-series-owner"
                  value={seriesOwnerId}
                  disabled={isPending}
                  onChange={(event) => setSeriesOwnerId(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {sortedUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="planning-series-venue">Venue</Label>
                <Select
                  id="planning-series-venue"
                  value={seriesVenueId}
                  disabled={isPending}
                  onChange={(event) => setSeriesVenueId(event.target.value)}
                >
                  <option value="">Global</option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <section className="space-y-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[var(--color-text)]">Task templates</h4>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => setTemplates((current) => [...current, createTemplateRow()])}
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add template
                </Button>
              </div>

              <div className="space-y-2">
                {templates.map((template) => (
                  <div key={template.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_130px]">
                    <Input
                      value={template.title}
                      maxLength={160}
                      placeholder="Task title"
                      disabled={isPending}
                      onChange={(event) =>
                        setTemplates((current) =>
                          current.map((entry) =>
                            entry.id === template.id ? { ...entry, title: event.target.value } : entry
                          )
                        )
                      }
                    />
                    <Select
                      value={template.assigneeId}
                      disabled={isPending}
                      onChange={(event) =>
                        setTemplates((current) =>
                          current.map((entry) =>
                            entry.id === template.id ? { ...entry, assigneeId: event.target.value } : entry
                          )
                        )
                      }
                    >
                      <option value="">To be determined</option>
                      {sortedUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </Select>
                    <Input
                      type="number"
                      min={-365}
                      max={365}
                      value={template.dueOffsetDays}
                      disabled={isPending}
                      placeholder="Due offset"
                      onChange={(event) =>
                        setTemplates((current) =>
                          current.map((entry) =>
                            entry.id === template.id ? { ...entry, dueOffsetDays: event.target.value } : entry
                          )
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </section>

            <Button type="button" disabled={isPending} onClick={submitSeries}>
              <Repeat className="mr-1 h-4 w-4" aria-hidden="true" /> Create recurring series
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
