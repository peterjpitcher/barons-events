"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Repeat } from "lucide-react";
import { createPlanningItemAction, createPlanningSeriesAction } from "@/actions/planning";
import { VenueMultiSelect, type VenueOption } from "@/components/venues/venue-multi-select";
import { SopNotRequiredPicker } from "@/components/planning/sop-not-required-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field-error";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PlanningPerson, PlanningVenueOption, RecurrenceFrequency } from "@/lib/planning/types";
import type { SopTemplateTree } from "@/lib/planning/sop-types";

type PlanningItemEditorProps = {
  today: string;
  users: PlanningPerson[];
  venues: PlanningVenueOption[];
  onChanged: () => void;
  /** Current user's ID — used to default ownerId for non-admin users */
  currentUserId?: string;
  /** Whether the current user is an administrator */
  isAdministrator?: boolean;
  sopTemplate?: SopTemplateTree;
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

export function PlanningItemEditor({ today, users, venues, onChanged, currentUserId, isAdministrator: isAdmin, sopTemplate }: PlanningItemEditorProps) {
  const [mode, setMode] = useState<"single" | "series">("single");
  const [isPending, startTransition] = useTransition();

  // Non-admin users default to themselves as owner (RLS requires owner_id = auth.uid())
  const defaultOwnerId = isAdmin ? "" : (currentUserId ?? "");
  const defaultVenueId = !isAdmin && venues.length === 1 ? venues[0].id : "";

  const sortedUsers = useMemo(
    () => [...users].sort((left, right) => left.name.localeCompare(right.name)),
    [users]
  );
  const venueOptions = useMemo(
    () => venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      category: venue.category ?? "pub",
      isInternal: venue.isInternal
    } satisfies VenueOption)),
    [venues]
  );
  const defaultVenueIds = useMemo(
    () => (isAdmin ? venueOptions.map((venue) => venue.id) : []),
    [isAdmin, venueOptions]
  );

  const [itemTitle, setItemTitle] = useState("");
  const [itemType, setItemType] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemVenueId, setItemVenueId] = useState(defaultVenueId);
  const [itemVenueIds, setItemVenueIds] = useState<string[]>(defaultVenueIds);
  const [itemOwnerId, setItemOwnerId] = useState(defaultOwnerId);
  const [itemTargetDate, setItemTargetDate] = useState(today);
  const [itemSopNotRequiredIds, setItemSopNotRequiredIds] = useState<string[]>([]);
  const [singleFieldErrors, setSingleFieldErrors] = useState<Record<string, string>>({});

  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesType, setSeriesType] = useState("");
  const [seriesDescription, setSeriesDescription] = useState("");
  const [seriesVenueId, setSeriesVenueId] = useState(defaultVenueId);
  const [seriesOwnerId, setSeriesOwnerId] = useState(defaultOwnerId);
  const [frequency, setFrequency] = useState<RecurrenceFrequency>("weekly");
  const [interval, setInterval] = useState("1");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [monthday, setMonthday] = useState("1");
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState("");
  const [seriesSopNotRequiredIds, setSeriesSopNotRequiredIds] = useState<string[]>([]);
  const [seriesFieldErrors, setSeriesFieldErrors] = useState<Record<string, string>>({});

  function runAction<T>(
    work: () => Promise<T>,
    successMessage: string,
    onSuccess: () => void,
    setFieldErrors: (errors: Record<string, string>) => void,
  ) {
    startTransition(async () => {
      setFieldErrors({});
      const result: unknown = await work();
      if (result && typeof result === "object" && "success" in result && !(result as { success: boolean }).success) {
        const actionResult = result as { message?: string; fieldErrors?: Record<string, string> };
        setFieldErrors(actionResult.fieldErrors ?? {});
        toast.error(actionResult.message ?? "Could not save planning data.");
        return;
      }

      toast.success(successMessage);
      onSuccess();
      onChanged();
    });
  }

  function resetSingleForm() {
    setItemTitle("");
    setItemType("");
    setItemDescription("");
    setItemVenueId(defaultVenueId);
    setItemVenueIds(defaultVenueIds);
    setItemOwnerId(defaultOwnerId);
    setItemTargetDate(today);
    setItemSopNotRequiredIds([]);
    setSingleFieldErrors({});
  }

  function resetSeriesForm() {
    setSeriesTitle("");
    setSeriesType("");
    setSeriesDescription("");
    setSeriesVenueId(defaultVenueId);
    setSeriesOwnerId(defaultOwnerId);
    setFrequency("weekly");
    setInterval("1");
    setWeekdays([1]);
    setMonthday("1");
    setStartsOn(today);
    setEndsOn("");
    setSeriesSopNotRequiredIds([]);
    setSeriesFieldErrors({});
  }

  function submitSingleItem() {
    setSingleFieldErrors({});
    if (!itemTitle.trim() || !itemType.trim() || !itemTargetDate) {
      toast.error("Add title, planning type, and target date.");
      setSingleFieldErrors({
        ...(!itemTitle.trim() ? { title: "Add a title" } : {}),
        ...(!itemType.trim() ? { typeLabel: "Add a planning type" } : {}),
        ...(!itemTargetDate ? { targetDate: "Choose a target date" } : {})
      });
      return;
    }

    // One planning item, any number of venues. Admins use the multi-select;
    // non-admins fall back to the single venue Select.
    const venueIds = isAdmin ? itemVenueIds : itemVenueId ? [itemVenueId] : [];
    const successMessage =
      venueIds.length <= 1
        ? "Planning item created."
        : `Planning item created, linked to ${venueIds.length} venues.`;

    runAction(
      () =>
        createPlanningItemAction({
          title: itemTitle,
          typeLabel: itemType,
          description: itemDescription,
          venueIds,
          ownerId: itemOwnerId,
          targetDate: itemTargetDate,
          status: "planned",
          sopNotRequiredTemplateIds: itemSopNotRequiredIds
        }),
      successMessage,
      resetSingleForm,
      setSingleFieldErrors
    );
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
    setSeriesFieldErrors({});
    if (!seriesTitle.trim() || !seriesType.trim() || !startsOn) {
      toast.error("Add series title, planning type, and start date.");
      setSeriesFieldErrors({
        ...(!seriesTitle.trim() ? { title: "Add a title" } : {}),
        ...(!seriesType.trim() ? { typeLabel: "Add a planning type" } : {}),
        ...(!startsOn ? { startsOn: "Choose a start date" } : {})
      });
      return;
    }

    const recurrenceInterval = Number(interval);
    if (!Number.isInteger(recurrenceInterval) || recurrenceInterval < 1) {
      toast.error("Recurrence interval must be a whole number.");
      setSeriesFieldErrors({ recurrenceInterval: "Use a whole number of 1 or more" });
      return;
    }

    const parsedMonthday = Number(monthday);

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
          sopNotRequiredTemplateIds: seriesSopNotRequiredIds
        }),
      "Recurring series created.",
      resetSeriesForm,
      setSeriesFieldErrors
    );
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div>
          <CardTitle>Create planning work</CardTitle>
          <CardDescription>
            Add one-off operational actions or recurring planning schedules.
          </CardDescription>
        </div>
        <div className="mobile-scroll-row md:flex md:flex-wrap md:items-center md:gap-2">
          <Button type="button" variant={mode === "single" ? "primary" : "ghost"} size="sm" className="h-11 rounded-full px-4 md:h-8 md:rounded-[6px]" onClick={() => setMode("single")}>
            Single item
          </Button>
          <Button type="button" variant={mode === "series" ? "primary" : "ghost"} size="sm" className="h-11 rounded-full px-4 md:h-8 md:rounded-[6px]" onClick={() => setMode("series")}>
            Recurring series
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {mode === "single" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="planning-item-title">Title</Label>
                  <Input
                    id="planning-item-title"
                    value={itemTitle}
                    maxLength={160}
                    disabled={isPending}
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(singleFieldErrors.title)}
                    aria-describedby="planning-item-title-error"
                    onChange={(event) => setItemTitle(event.target.value)}
                  />
                  <FieldError id="planning-item-title-error" message={singleFieldErrors.title} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="planning-item-type">Planning type</Label>
                  <Input
                    id="planning-item-type"
                    value={itemType}
                    maxLength={120}
                    placeholder="Menu launch, ops change, etc."
                    disabled={isPending}
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(singleFieldErrors.typeLabel)}
                    aria-describedby="planning-item-type-error"
                    onChange={(event) => setItemType(event.target.value)}
                  />
                  <FieldError id="planning-item-type-error" message={singleFieldErrors.typeLabel} />
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
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(singleFieldErrors.targetDate)}
                    aria-describedby="planning-item-target-error"
                    onChange={(event) => setItemTargetDate(event.target.value)}
                  />
                  <FieldError id="planning-item-target-error" message={singleFieldErrors.targetDate} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="planning-item-owner">Owner</Label>
                  <Select
                    id="planning-item-owner"
                    value={itemOwnerId}
                    disabled={isPending}
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    onChange={(event) => setItemOwnerId(event.target.value)}
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
                  <FieldLabel
                    htmlFor="planning-item-venue"
                    help="Use Global item for all venues, or select one or more specific venues. Tasks with a one per venue SOP setting fan out automatically."
                  >
                    Venues
                  </FieldLabel>
                  {isAdmin ? (
                    <VenueMultiSelect
                      venues={venueOptions}
                      selectedIds={itemVenueIds}
                      onChange={setItemVenueIds}
                      disabled={isPending}
                      allowEmpty={false}
                      globalSelectionMode="all"
                      emptyLabel="Global item"
                      emptyDescription="All venues are included."
                      placeholder="Choose venues"
                    />
                  ) : (
                    <Select
                      id="planning-item-venue"
                      value={itemVenueId}
                      disabled={isPending}
                      className="h-12 text-[16px] md:h-10 md:text-sm"
                      aria-invalid={Boolean(singleFieldErrors.venueId ?? singleFieldErrors.venueIds)}
                      aria-describedby="planning-item-venue-error"
                      onChange={(event) => setItemVenueId(event.target.value)}
                    >
                      {venues.map((venue) => (
                        <option key={venue.id} value={venue.id}>
                          {venue.name}
                        </option>
                      ))}
                    </Select>
                  )}
                  <FieldError id="planning-item-venue-error" message={singleFieldErrors.venueId ?? singleFieldErrors.venueIds} />
                </div>
              </div>
              <Button type="button" disabled={isPending} className="hidden md:inline-flex" onClick={submitSingleItem}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add planning item
              </Button>
            </div>
            <SopNotRequiredPicker
              template={sopTemplate}
              value={itemSopNotRequiredIds}
              onChange={setItemSopNotRequiredIds}
              disabled={isPending}
              variant="rail"
              className="xl:sticky xl:top-[72px] xl:self-start"
            />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="planning-series-title">Series title</Label>
                  <Input
                    id="planning-series-title"
                    value={seriesTitle}
                    maxLength={160}
                    disabled={isPending}
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(seriesFieldErrors.title)}
                    aria-describedby="planning-series-title-error"
                    onChange={(event) => setSeriesTitle(event.target.value)}
                  />
                  <FieldError id="planning-series-title-error" message={seriesFieldErrors.title} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="planning-series-type">Planning type</Label>
                  <Input
                    id="planning-series-type"
                    value={seriesType}
                    maxLength={120}
                    placeholder="Menu launch, ops change, etc."
                    disabled={isPending}
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(seriesFieldErrors.typeLabel)}
                    aria-describedby="planning-series-type-error"
                    onChange={(event) => setSeriesType(event.target.value)}
                  />
                  <FieldError id="planning-series-type-error" message={seriesFieldErrors.typeLabel} />
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
                    className="h-12 text-[16px] md:h-10 md:text-sm"
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
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    inputMode="numeric"
                    aria-invalid={Boolean(seriesFieldErrors.recurrenceInterval)}
                    aria-describedby="planning-series-interval-error"
                    onChange={(event) => setInterval(event.target.value)}
                  />
                  <FieldError id="planning-series-interval-error" message={seriesFieldErrors.recurrenceInterval} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="planning-series-start">Starts on</Label>
                  <Input
                    id="planning-series-start"
                    type="date"
                    value={startsOn}
                    disabled={isPending}
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(seriesFieldErrors.startsOn)}
                    aria-describedby="planning-series-start-error"
                    onChange={(event) => setStartsOn(event.target.value)}
                  />
                  <FieldError id="planning-series-start-error" message={seriesFieldErrors.startsOn} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="planning-series-end">Ends on (optional)</Label>
                  <Input
                    id="planning-series-end"
                    type="date"
                    value={endsOn}
                    disabled={isPending}
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(seriesFieldErrors.endsOn)}
                    aria-describedby="planning-series-end-error"
                    onChange={(event) => setEndsOn(event.target.value)}
                  />
                  <FieldError id="planning-series-end-error" message={seriesFieldErrors.endsOn} />
                </div>
              </div>

              {frequency === "weekly" ? (
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle">Weekdays</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAY_OPTIONS.map((weekday) => (
                      <label key={weekday.value} className="inline-flex items-center gap-1 rounded-full border border-[var(--hair)] px-2 py-1 text-xs">
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
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    inputMode="numeric"
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
                    className="h-12 text-[16px] md:h-10 md:text-sm"
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
                    className="h-12 text-[16px] md:h-10 md:text-sm"
                    aria-invalid={Boolean(seriesFieldErrors.venueId)}
                    aria-describedby="planning-series-venue-error"
                    onChange={(event) => setSeriesVenueId(event.target.value)}
                  >
                    {isAdmin ? <option value="">Global</option> : null}
                    {venues.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </Select>
                  <FieldError id="planning-series-venue-error" message={seriesFieldErrors.venueId} />
                </div>
              </div>

              <Button type="button" disabled={isPending} className="hidden md:inline-flex" onClick={submitSeries}>
                <Repeat className="mr-1 h-4 w-4" aria-hidden="true" /> Create recurring series
              </Button>
            </div>
            <SopNotRequiredPicker
              template={sopTemplate}
              value={seriesSopNotRequiredIds}
              onChange={setSeriesSopNotRequiredIds}
              disabled={isPending}
              variant="rail"
              note="The below items are standard SOP when submitting this recurring planning series, please tick any todos below that aren't required for each generated planning item so owners don't get alerted."
              className="xl:sticky xl:top-[72px] xl:self-start"
            />
          </div>
        )}
      </CardContent>
      <div className="mobile-actionbar md:hidden">
        {mode === "single" ? (
          <Button type="button" variant="primary" className="h-12 flex-1" disabled={isPending} onClick={submitSingleItem}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add planning item
          </Button>
        ) : (
          <Button type="button" variant="primary" className="h-12 flex-1" disabled={isPending} onClick={submitSeries}>
            <Repeat className="h-4 w-4" aria-hidden="true" />
            Create series
          </Button>
        )}
      </div>
    </Card>
  );
}
