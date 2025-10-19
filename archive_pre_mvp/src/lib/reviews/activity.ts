import type { BadgeVariant } from "@/components/ui/badge";

export type SlaTone = "ok" | "warn" | "overdue" | "muted";

export type SlaStatus = {
  label: string;
  tone: SlaTone;
  rowToneClass: string;
  badgeVariant: BadgeVariant;
  action: string | null;
};

export const slaRowToneClasses: Record<SlaTone, string> = {
  ok: "bg-[rgba(47,143,104,0.08)]",
  warn: "bg-[rgba(196,125,78,0.12)]",
  overdue: "bg-[rgba(193,77,77,0.12)]",
  muted: "",
};

export const slaBadgeVariantMap: Record<SlaTone, BadgeVariant> = {
  ok: "success",
  warn: "warning",
  overdue: "danger",
  muted: "neutral",
};

export function getSlaStatus(value: string | null): SlaStatus {
  if (!value) {
    return {
      label: "No date",
      tone: "muted",
      rowToneClass: slaRowToneClasses.muted,
      badgeVariant: slaBadgeVariantMap.muted,
      action: null,
    };
  }

  const start = new Date(value);
  if (Number.isNaN(start.getTime())) {
    return {
      label: "Invalid date",
      tone: "muted",
      rowToneClass: slaRowToneClasses.muted,
      badgeVariant: slaBadgeVariantMap.muted,
      action: null,
    };
  }

  const diffMs = start.getTime() - Date.now();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays >= 3) {
    return {
      label: `Due in ${diffDays} day${diffDays === 1 ? "" : "s"}`,
      tone: "ok",
      rowToneClass: slaRowToneClasses.ok,
      badgeVariant: slaBadgeVariantMap.ok,
      action: null,
    };
  }

  if (diffDays >= 0) {
    const imminenceLabel = diffDays === 0 ? "Decision due today" : "Follow up within 24h";

    return {
      label: `Due in ${diffDays} day${diffDays === 1 ? "" : "s"}`,
      tone: "warn",
      rowToneClass: slaRowToneClasses.warn,
      badgeVariant: slaBadgeVariantMap.warn,
      action: imminenceLabel,
    };
  }

  return {
    label: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? "" : "s"}`,
    tone: "overdue",
    rowToneClass: slaRowToneClasses.overdue,
    badgeVariant: slaBadgeVariantMap.overdue,
    action: "Escalate to Central planner",
  };
}

export const reviewStatusLabels: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  needs_revisions: "Needs revisions",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  completed: "Completed",
};

export const reviewStatusVariants: Record<string, BadgeVariant> = {
  draft: "neutral",
  submitted: "info",
  needs_revisions: "warning",
  approved: "success",
  rejected: "danger",
  published: "success",
  completed: "success",
};
