"use client";

import { cn } from "@/lib/utils";
import type { SopTemplateTree } from "@/lib/planning/sop-types";

type SopNotRequiredPickerProps = {
  template?: SopTemplateTree | null;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  name?: string;
  variant?: "inline" | "rail";
  note?: string;
  className?: string;
};

export function SopNotRequiredPicker({
  template,
  value,
  onChange,
  disabled = false,
  name,
  variant = "inline",
  note = "The below items are standard SOP when submitting this event/planning item, please tick any todos below that aren't required for this event/planning item so owners don't get alerted.",
  className,
}: SopNotRequiredPickerProps) {
  const selected = new Set(value);
  const taskCount = template?.sections.reduce((count, section) => count + section.tasks.length, 0) ?? 0;

  if (!template || taskCount === 0) {
    return null;
  }

  function toggleTask(templateId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) {
      next.add(templateId);
    } else {
      next.delete(templateId);
    }
    onChange(Array.from(next));
  }

  return (
    <section
      className={cn(
        "space-y-3 rounded-[var(--radius-sm)] border border-[var(--hair)] p-3",
        variant === "rail" ? "bg-[var(--paper)] shadow-card" : "bg-[var(--canvas-2)]",
        className
      )}
    >
      {name
        ? value.map((templateId) => (
            <input key={templateId} type="hidden" name={name} value={templateId} />
          ))
        : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--ink)]">SOP items marked N/A</h4>
        <span className="font-brand-mono text-[0.625rem] uppercase tracking-[0.05em] text-[var(--ink-muted)]">
          {value.length}/{taskCount}
        </span>
      </div>
      <p className="text-xs leading-5 text-[var(--ink-muted)]">
        {note}
      </p>
      <div className={cn("space-y-3 overflow-y-auto pr-1", variant === "rail" ? "max-h-[calc(100vh-15rem)]" : "max-h-56")}>
        {template.sections.map((section) => (
          <fieldset key={section.id} className="space-y-1.5">
            <legend className="font-brand-mono text-[0.6rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
              {section.label}
            </legend>
            <div className="space-y-1">
              {section.tasks.map((task) => (
                <label
                  key={task.id}
                  className="flex cursor-pointer items-start gap-2 rounded-[6px] border border-[var(--hair)] bg-[var(--paper)] px-2 py-1.5 text-xs text-[var(--ink)]"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[var(--navy)]"
                    checked={selected.has(task.id)}
                    disabled={disabled}
                    onChange={(event) => toggleTask(task.id, event.target.checked)}
                  />
                  <span className="min-w-0 flex-1 leading-snug">{task.title}</span>
                  <span className="shrink-0 rounded-[5px] bg-[var(--canvas)] px-1.5 py-0.5 font-brand-mono text-[0.56rem] uppercase tracking-[0.05em] text-[var(--ink-muted)]">
                    N/A
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
