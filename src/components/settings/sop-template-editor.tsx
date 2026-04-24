"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  loadSopTemplateAction,
  createSopSectionAction,
  updateSopSectionAction,
  deleteSopSectionAction,
  createSopTaskTemplateAction,
  updateSopTaskTemplateAction,
  deleteSopTaskTemplateAction,
  createSopDependencyAction,
  deleteSopDependencyByCompositeAction,
  loadSopAssignableUsersAction,
} from "@/actions/sop";
import type { SopSectionWithTasks, SopTaskTemplate } from "@/lib/planning/sop-types";
import {
  ROLE_MANAGER_RESPONSIBLE,
  ROLE_EVENT_CREATOR,
  DYNAMIC_ROLE_LABELS,
} from "@/lib/planning/constants";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Loader2, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type AssignableUser = { id: string; name: string };

type TaskWithDeps = SopTaskTemplate & {
  dependencies: Array<{ dependsOnTemplateId: string }>;
};

// ─── Main component ──────────────────────────────────────────────────────────

export function SopTemplateEditor(): React.ReactElement {
  const [sections, setSections] = useState<SopSectionWithTasks[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [template, userList] = await Promise.all([
        loadSopTemplateAction(),
        loadSopAssignableUsersAction(),
      ]);
      setSections(template.sections);
      setCanEdit(template.canEdit);
      setUsers(userList);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load SOP template.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-[var(--color-danger)]">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="space-y-4">
        {canEdit && <AddSectionButton sections={sections} onCreated={reload} />}
        <Card>
          <CardContent className="py-8 text-center text-subtle">
            No SOP template configured yet — add your first section.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {canEdit && <AddSectionButton sections={sections} onCreated={reload} />}
      {sections.map((section) => (
        <SectionPanel
          key={section.id}
          section={section}
          allSections={sections}
          users={users}
          canEdit={canEdit}
          onChanged={reload}
        />
      ))}
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton(): React.ReactElement {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="py-6">
            <div className="animate-pulse space-y-3">
              <div className="h-5 w-48 rounded bg-[var(--color-muted-surface)]" />
              <div className="h-4 w-32 rounded bg-[var(--color-muted-surface)]" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Add section button ──────────────────────────────────────────────────────

function AddSectionButton({
  sections,
  onCreated,
}: {
  sections: SopSectionWithTasks[];
  onCreated: () => Promise<void>;
}): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(): Promise<void> {
    if (!label.trim()) return;
    setSaving(true);
    const result = await createSopSectionAction({
      label: label.trim(),
      sortOrder: sections.length,
      defaultAssigneeIds: [],
    });
    setSaving(false);
    if (result.success) {
      toast.success(result.message ?? "Section created.");
      setLabel("");
      setAdding(false);
      await onCreated();
    } else {
      toast.error(result.message ?? "Could not create section.");
    }
  }

  if (!adding) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add Section
      </Button>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-end gap-3 py-4">
        <div className="flex-1 space-y-1">
          <label htmlFor="new-section-label" className="text-sm font-medium text-[var(--color-text)]">
            Section name
          </label>
          <Input
            id="new-section-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Pre-Event Setup"
            disabled={saving}
          />
        </div>
        <Button size="sm" disabled={saving || !label.trim()} onClick={handleAdd}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving..." : "Create"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAdding(false);
            setLabel("");
          }}
          disabled={saving}
        >
          Cancel
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Section panel ───────────────────────────────────────────────────────────

function SectionPanel({
  section,
  allSections,
  users,
  canEdit,
  onChanged,
}: {
  section: SopSectionWithTasks;
  allSections: SopSectionWithTasks[];
  users: AssignableUser[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(section.label);
  const [savingLabel, setSavingLabel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sectionAssigneeIds, setSectionAssigneeIds] = useState<string[]>(section.defaultAssigneeIds);
  const [savingSectionAssignees, setSavingSectionAssignees] = useState(false);

  async function handleSectionAssigneesChange(newIds: string[]): Promise<void> {
    setSectionAssigneeIds(newIds);
    setSavingSectionAssignees(true);
    const result = await updateSopSectionAction({
      id: section.id,
      defaultAssigneeIds: newIds,
    });
    setSavingSectionAssignees(false);
    if (result.success) {
      toast.success("Section default assignees updated.");
      await onChanged();
    } else {
      toast.error(result.message ?? "Could not update section assignees.");
      setSectionAssigneeIds(section.defaultAssigneeIds);
    }
  }

  // Collect all task templates across all sections for dependency selection
  const allTasks = allSections.flatMap((s) => s.tasks);

  async function handleLabelSave(): Promise<void> {
    if (!label.trim() || label.trim() === section.label) {
      setEditingLabel(false);
      setLabel(section.label);
      return;
    }
    setSavingLabel(true);
    const result = await updateSopSectionAction({
      id: section.id,
      label: label.trim(),
      sortOrder: section.sortOrder,
      defaultAssigneeIds: section.defaultAssigneeIds,
    });
    setSavingLabel(false);
    if (result.success) {
      toast.success(result.message ?? "Section updated.");
      setEditingLabel(false);
      await onChanged();
    } else {
      toast.error(result.message ?? "Could not update section.");
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    const result = await deleteSopSectionAction(section.id);
    setDeleting(false);
    setConfirmDelete(false);
    if (result.success) {
      toast.success(result.message ?? "Section deleted.");
      await onChanged();
    } else {
      toast.error(result.message ?? "Could not delete section.");
    }
  }

  return (
    <>
      <Card>
        <div
          className="flex cursor-pointer items-center gap-3 px-5 py-4"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => setExpanded((p) => !p)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setExpanded((p) => !p);
            }
          }}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
          )}

          {editingLabel && canEdit ? (
            <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={savingLabel}
                className="max-w-xs"
                aria-label="Section name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleLabelSave();
                  }
                  if (e.key === "Escape") {
                    setEditingLabel(false);
                    setLabel(section.label);
                  }
                }}
                autoFocus
              />
              <Button size="sm" disabled={savingLabel} onClick={() => void handleLabelSave()}>
                {savingLabel ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingLabel(false);
                  setLabel(section.label);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-3">
              <span
                className="text-base font-semibold text-[var(--color-text)]"
                onDoubleClick={(e) => {
                  if (canEdit) {
                    e.stopPropagation();
                    setEditingLabel(true);
                  }
                }}
              >
                {section.label}
              </span>
              <Badge variant="neutral">
                {section.tasks.length} {section.tasks.length === 1 ? "task" : "tasks"}
              </Badge>
            </div>
          )}

          {canEdit && !editingLabel && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingLabel(true)}
                aria-label={`Rename section ${section.label}`}
              >
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                aria-label={`Delete section ${section.label}`}
                className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>

        {expanded && (
          <CardContent className="space-y-3 border-t border-[var(--color-border)] pt-4">
            {/* Section-level default assignees */}
            <div className="space-y-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-subtle">
                  Pick names from the list to assign all todos in this section to them
                </span>
              </div>
              <MultiSelect
                options={users}
                selectedIds={sectionAssigneeIds}
                onChange={(ids) => void handleSectionAssigneesChange(ids)}
                disabled={!canEdit || savingSectionAssignees}
                placeholder="Assign people to all tasks in this section..."
              />
              {savingSectionAssignees && (
                <p className="text-xs text-subtle flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Saving...
                </p>
              )}
            </div>

            {section.tasks.length === 0 ? (
              <p className="text-sm text-subtle">No tasks in this section yet.</p>
            ) : (
              <div className="space-y-2">
                {section.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    allTasks={allTasks}
                    users={users}
                    canEdit={canEdit}
                    onChanged={onChanged}
                    sectionAssigneeIds={section.defaultAssigneeIds}
                  />
                ))}
              </div>
            )}
            {canEdit && (
              <AddTaskButton sectionId={section.id} taskCount={section.tasks.length} onCreated={onChanged} />
            )}
          </CardContent>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete section?"
        description={`This will permanently delete "${section.label}" and all its tasks. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ─── Task row ────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  allTasks,
  users,
  canEdit,
  onChanged,
  sectionAssigneeIds,
}: {
  task: TaskWithDeps;
  allTasks: TaskWithDeps[];
  users: AssignableUser[];
  canEdit: boolean;
  onChanged: () => Promise<void>;
  sectionAssigneeIds: string[];
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [tMinusDays, setTMinusDays] = useState(task.tMinusDays);
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task.defaultAssigneeIds);
  // Compose the expansion dropdown into a single value:
  //   "single" | "per_venue:all" | "per_venue:pub" | "per_venue:cafe"
  const initialExpansion: string =
    task.expansionStrategy === "per_venue"
      ? `per_venue:${task.venueFilter ?? "pub"}`
      : "single";
  const [expansion, setExpansion] = useState<string>(initialExpansion);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Available tasks for dependency selection (exclude self and tasks already depended on)
  const currentDepIds = task.dependencies.map((d) => d.dependsOnTemplateId);
  const availableForDep = allTasks.filter(
    (t) => t.id !== task.id && !currentDepIds.includes(t.id)
  );

  async function handleSave(): Promise<void> {
    if (!title.trim()) return;
    setSaving(true);
    const [strategyRaw, filterRaw] = expansion.split(":");
    const expansionStrategy = strategyRaw === "per_venue" ? "per_venue" : "single";
    const venueFilter =
      expansionStrategy === "per_venue"
        ? ((filterRaw === "all" || filterRaw === "pub" || filterRaw === "cafe") ? filterRaw : "pub")
        : null;
    const result = await updateSopTaskTemplateAction({
      id: task.id,
      sectionId: task.sectionId,
      title: title.trim(),
      sortOrder: task.sortOrder,
      defaultAssigneeIds: assigneeIds,
      tMinusDays,
      expansionStrategy,
      venueFilter,
    });
    setSaving(false);
    if (result.success) {
      toast.success(result.message ?? "Task updated.");
      setEditing(false);
      await onChanged();
    } else {
      toast.error(result.message ?? "Could not update task.");
    }
  }

  async function handleDelete(): Promise<void> {
    setDeleting(true);
    const result = await deleteSopTaskTemplateAction(task.id);
    setDeleting(false);
    setConfirmDelete(false);
    if (result.success) {
      toast.success(result.message ?? "Task deleted.");
      await onChanged();
    } else {
      toast.error(result.message ?? "Could not delete task.");
    }
  }

  async function handleAddDependency(dependsOnId: string): Promise<void> {
    const result = await createSopDependencyAction({
      taskTemplateId: task.id,
      dependsOnTemplateId: dependsOnId,
    });
    if (result.success) {
      toast.success(result.message ?? "Dependency added.");
      await onChanged();
    } else {
      toast.error(result.message ?? "Could not add dependency.");
    }
  }

  async function handleRemoveDependency(dependsOnTemplateId: string): Promise<void> {
    const result = await deleteSopDependencyByCompositeAction({
      taskTemplateId: task.id,
      dependsOnTemplateId,
    });
    if (result.success) {
      toast.success(result.message ?? "Dependency removed.");
      await onChanged();
    } else {
      toast.error(result.message ?? "Could not remove dependency.");
    }
  }

  if (!editing) {
    // Read-only display
    const depNames = currentDepIds
      .map((depId) => allTasks.find((t) => t.id === depId)?.title ?? "Unknown")
      .filter(Boolean);

    // Resolve displayed assignees: task override → section default → none
    const hasTaskOverride = assigneeIds.length > 0;
    const resolvedIds = hasTaskOverride ? assigneeIds : sectionAssigneeIds;
    const resolvedNames = resolvedIds
      .map((uid) => users.find((u) => u.id === uid)?.name ?? "Unknown")
      .filter(Boolean);

    return (
      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-3">
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--color-text)]">{task.title}</span>
            <Badge variant="info">T-{task.tMinusDays}d</Badge>
          </div>
          {resolvedNames.length > 0 ? (
            <p className="text-xs text-subtle">
              Assignees: {resolvedNames.join(", ")}
              {!hasTaskOverride && (
                <span className="italic text-[var(--color-primary-400)]"> (from section)</span>
              )}
              {hasTaskOverride && (
                <span className="text-[var(--color-primary-400)]"> (task override)</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-subtle italic">
              Assignees: none set
            </p>
          )}
          {depNames.length > 0 && (
            <p className="text-xs text-subtle">
              Depends on: {depNames.join(", ")}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Edit task ${task.title}`}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting}
              aria-label={`Delete task ${task.title}`}
              className="text-[var(--color-danger)] hover:text-[var(--color-danger)]"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        )}

        <ConfirmDialog
          open={confirmDelete}
          title="Delete task?"
          description={`This will permanently delete "${task.title}". This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(false)}
        />
      </div>
    );
  }

  // Editing mode
  return (
    <div className="space-y-3 rounded-[var(--radius)] border border-[var(--color-primary-400)] bg-[var(--color-muted-surface)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`task-title-${task.id}`} className="text-xs font-medium text-subtle">
            Title
          </label>
          <Input
            id={`task-title-${task.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`task-tminus-${task.id}`} className="text-xs font-medium text-subtle">
            T-minus days
          </label>
          <Input
            id={`task-tminus-${task.id}`}
            type="number"
            min={0}
            value={tMinusDays}
            onChange={(e) => setTMinusDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
            disabled={saving}
          />
        </div>
      </div>

      {/* Expansion strategy */}
      <div className="space-y-1">
        <label htmlFor={`task-expansion-${task.id}`} className="text-xs font-medium text-subtle">
          Create one per
        </label>
        <select
          id={`task-expansion-${task.id}`}
          value={expansion}
          onChange={(e) => setExpansion(e.target.value)}
          disabled={saving}
          className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-text)]"
        >
          <option value="single">Task (single)</option>
          <option value="per_venue:pub">Pub (one task per pub)</option>
          <option value="per_venue:cafe">Cafe (one task per cafe)</option>
          <option value="per_venue:all">Every venue</option>
        </select>
        <p className="text-xs text-subtle">
          &quot;Per venue&quot; tasks generate one master plus one child per matching venue, each assigned to that venue&apos;s default manager.
        </p>
      </div>

      {/* Assignees multi-select */}
      <div className="space-y-1">
        <span className="text-xs font-medium text-subtle">Default assignees</span>
        <MultiSelect
          options={users}
          selectedIds={assigneeIds}
          onChange={setAssigneeIds}
          disabled={saving}
          placeholder="Select assignees..."
        />
      </div>

      {/* Dependencies */}
      <div className="space-y-1">
        <span className="text-xs font-medium text-subtle">Dependencies</span>
        {currentDepIds.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {currentDepIds.map((depId) => {
              const depTask = allTasks.find((t) => t.id === depId);
              return (
                <span
                  key={depId}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--color-muted-surface)] border border-[var(--color-border)] px-2 py-0.5 text-xs text-subtle"
                >
                  {depTask?.title ?? "Unknown"}
                  <button
                    type="button"
                    className="ml-1 text-[var(--color-danger)] hover:text-[#dc2626]"
                    onClick={() => void handleRemoveDependency(depId)}
                    aria-label={`Remove dependency on ${depTask?.title ?? "unknown task"}`}
                  >
                    &times;
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {availableForDep.length > 0 && (
          <select
            className="mt-1 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                void handleAddDependency(e.target.value);
              }
            }}
            disabled={saving}
          >
            <option value="">Add dependency...</option>
            {availableForDep.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-2">
        <Button size="sm" disabled={saving || !title.trim()} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={() => {
            setEditing(false);
            setTitle(task.title);
            setTMinusDays(task.tMinusDays);
            setAssigneeIds(task.defaultAssigneeIds);
            setExpansion(initialExpansion);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Add task button ─────────────────────────────────────────────────────────

function AddTaskButton({
  sectionId,
  taskCount,
  onCreated,
}: {
  sectionId: string;
  taskCount: number;
  onCreated: () => Promise<void>;
}): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [tMinusDays, setTMinusDays] = useState(0);
  const [saving, setSaving] = useState(false);

  async function handleAdd(): Promise<void> {
    if (!title.trim()) return;
    setSaving(true);
    const result = await createSopTaskTemplateAction({
      sectionId,
      title: title.trim(),
      sortOrder: taskCount,
      defaultAssigneeIds: [],
      tMinusDays,
    });
    setSaving(false);
    if (result.success) {
      toast.success(result.message ?? "Task created.");
      setTitle("");
      setTMinusDays(0);
      setAdding(false);
      await onCreated();
    } else {
      toast.error(result.message ?? "Could not create task.");
    }
  }

  if (!adding) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add task
      </Button>
    );
  }

  return (
    <div className="flex items-end gap-3 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] p-3">
      <div className="flex-1 space-y-1">
        <label htmlFor={`new-task-${sectionId}`} className="text-xs font-medium text-subtle">
          Task title
        </label>
        <Input
          id={`new-task-${sectionId}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Confirm AV requirements"
          disabled={saving}
        />
      </div>
      <div className="w-24 space-y-1">
        <label htmlFor={`new-task-tminus-${sectionId}`} className="text-xs font-medium text-subtle">
          T-minus
        </label>
        <Input
          id={`new-task-tminus-${sectionId}`}
          type="number"
          min={0}
          value={tMinusDays}
          onChange={(e) => setTMinusDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
          disabled={saving}
        />
      </div>
      <Button size="sm" disabled={saving || !title.trim()} onClick={handleAdd}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        {saving ? "Saving..." : "Add"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setAdding(false);
          setTitle("");
          setTMinusDays(0);
        }}
        disabled={saving}
      >
        Cancel
      </Button>
    </div>
  );
}

// ─── Multi-select (simple checkbox dropdown) ─────────────────────────────────

function MultiSelect({
  options,
  selectedIds,
  onChange,
  disabled,
  placeholder,
}: {
  options: AssignableUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  // Dynamic role options shown above the user list
  const dynamicRoles: AssignableUser[] = [
    { id: ROLE_MANAGER_RESPONSIBLE, name: DYNAMIC_ROLE_LABELS[ROLE_MANAGER_RESPONSIBLE] },
    { id: ROLE_EVENT_CREATOR, name: DYNAMIC_ROLE_LABELS[ROLE_EVENT_CREATOR] },
  ];

  function toggle(id: string): void {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  // Resolve display names — use dynamic role labels for sentinels, user names for real IDs
  const selectedNames = selectedIds
    .map((id) => DYNAMIC_ROLE_LABELS[id] ?? options.find((o) => o.id === id)?.name)
    .filter(Boolean);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-[var(--radius)] border border-[var(--color-border)] bg-white px-3 py-2 text-left text-sm shadow-soft disabled:cursor-not-allowed disabled:bg-[rgba(39,54,64,0.06)]"
        onClick={() => setOpen((p) => !p)}
        disabled={disabled}
      >
        <span className={selectedNames.length > 0 ? "text-[var(--color-text)]" : "text-subtle"}>
          {selectedNames.length > 0 ? selectedNames.join(", ") : (placeholder ?? "Select...")}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-white shadow-soft">
          {/* Dynamic roles */}
          {dynamicRoles.map((role) => (
            <label
              key={role.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--color-primary-700)] hover:bg-[rgba(39,54,64,0.05)]"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(role.id)}
                onChange={() => toggle(role.id)}
                className="rounded border-[var(--color-border)]"
              />
              {role.name}
            </label>
          ))}
          {/* Divider */}
          <div className="border-t border-[var(--color-border)] my-1" />
          {/* Real users */}
          {options.length === 0 ? (
            <p className="p-3 text-sm text-subtle">No users available.</p>
          ) : (
            options.map((opt) => (
              <label
                key={opt.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[rgba(39,54,64,0.05)]"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(opt.id)}
                  onChange={() => toggle(opt.id)}
                  className="rounded border-[var(--color-border)]"
                />
                {opt.name}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
