import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const AVATAR_PALETTE = [
  "var(--navy)",
  "var(--slate)",
  "var(--burgundy)",
  "var(--sage)",
  "var(--mustard)",
  "var(--mustard-dark)",
  "var(--sage-dark)",
  "var(--slate-dark)",
];

function colorForName(name: string | null | undefined): string {
  if (!name) return AVATAR_PALETTE[0];
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function Avatar({
  name,
  size = 18,
  className,
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      title={name ?? undefined}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{
        width: size,
        height: size,
        background: colorForName(name),
        fontSize: Math.round(size * 0.42),
        boxShadow: "0 0 0 1.5px var(--paper)",
        letterSpacing: 0,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

export function AvatarStack({
  names,
  size = 18,
  max = 3,
}: {
  names: string[];
  size?: number;
  max?: number;
}) {
  const visible = names.slice(0, max);
  const overflow = names.length - visible.length;

  return (
    <span className="inline-flex items-center">
      {visible.map((name, index) => (
        <span key={`${name}-${index}`} style={{ marginLeft: index === 0 ? 0 : -6 }}>
          <Avatar name={name} size={size} />
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--canvas-2)] font-brand-mono font-semibold text-[var(--ink-muted)]"
          style={{
            marginLeft: -6,
            width: size,
            height: size,
            fontSize: Math.round(size * 0.36),
            boxShadow: "0 0 0 1.5px var(--paper)",
          }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}

export function Sparkline({
  values,
  width = 64,
  height = 22,
  color = "var(--navy)",
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1 || 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return [x, y] as const;
  });
  const path = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L ${width} ${height} L 0 ${height} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden="true">
      {fill ? <path d={area} fill={color} opacity={0.1} /> : null}
      <path d={path} fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
      <circle cx={lastX} cy={lastY} r="2" fill={color} />
    </svg>
  );
}

export function Delta({
  value,
  suffix = "%",
  positiveIsGood = false,
}: {
  value: number;
  suffix?: string;
  positiveIsGood?: boolean;
}) {
  const positive = value > 0;
  const good = value === 0 ? null : positiveIsGood ? positive : !positive;
  const tone =
    good === null
      ? "bg-[var(--canvas-2)] text-[var(--ink-muted)]"
      : good
        ? "bg-[var(--sage-tint)] text-[var(--sage-dark)]"
        : "bg-[var(--burgundy-tint)] text-[var(--burgundy)]";
  const arrow = value === 0 ? "." : positive ? "▲" : "▼";

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-brand-mono text-[0.625rem] font-semibold", tone)}>
      <span className="text-[0.5rem]">{arrow}</span>
      {Math.abs(value)}
      {suffix}
    </span>
  );
}

export function SLAChip({ days, label }: { days: number | null | undefined; label?: string }) {
  if (days == null) return null;
  if (days > 14) return null;

  let className = "bg-[var(--slate-tint)] text-[var(--slate-dark)]";
  let text = label ?? `Due in ${days}d`;
  if (days < 0) {
    className = "bg-[var(--burgundy-tint)] text-[var(--burgundy)]";
    text = label ?? `${Math.abs(days)}d overdue`;
  } else if (days === 0) {
    className = "bg-[var(--mustard-tint)] text-[var(--mustard-dark)]";
    text = label ?? "Due today";
  } else if (days <= 2) {
    className = "bg-[var(--mustard-tint)] text-[var(--mustard-dark)]";
  }

  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.04em]", className)}>
      {text}
    </span>
  );
}

export function ProgressRing({
  value,
  size = 14,
  color = "var(--navy)",
}: {
  value: number;
  size?: number;
  color?: string;
}) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <span
      className="relative inline-flex shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${safeValue * 3.6}deg, var(--canvas-2) 0)`,
      }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
    >
      <span className="absolute rounded-full bg-[var(--paper)]" style={{ inset: Math.max(2, Math.round(size * 0.22)) }} />
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-[var(--hair)] border-b-[1.5px] bg-[var(--canvas-2)] px-1 font-brand-mono text-[0.625rem] text-[var(--ink-muted)]">
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("app-page-header flex-wrap", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
        <h1 className="app-page-title">{title}</h1>
        {description ? <p className="app-page-subtitle">{description}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap items-center gap-2 font-brand-mono text-[0.65rem] uppercase tracking-[0.04em] text-[var(--ink-muted)]">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function MetricTile({
  label,
  value,
  hint,
  tone = "info",
  delta,
  sparkline,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "critical" | "warn" | "info" | "neutral";
  delta?: number;
  sparkline?: number[];
  onClick?: () => void;
}) {
  const toneClass = {
    critical: "bg-[var(--burgundy-tint)] text-[var(--burgundy)]",
    warn: "bg-[var(--mustard-tint)] text-[var(--mustard-dark)]",
    info: "bg-[var(--slate-tint)] text-[var(--slate-dark)]",
    neutral: "border border-[var(--hair)] bg-[var(--paper)] text-[var(--ink)]",
  }[tone];
  const barColor = {
    critical: "var(--burgundy)",
    warn: "var(--mustard)",
    info: "var(--slate)",
    neutral: "transparent",
  }[tone];
  const sparkColor = {
    critical: "var(--burgundy)",
    warn: "var(--mustard)",
    info: "var(--slate)",
    neutral: "var(--navy)",
  }[tone];
  const content = (
    <>
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: barColor }} />
      <div className="text-[0.625rem] font-semibold uppercase tracking-[0.12em]">{label}</div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="font-brand-serif text-[1.65rem] font-medium leading-none">{value}</div>
        {sparkline ? <Sparkline values={sparkline} color={sparkColor} /> : null}
      </div>
      {(hint || delta != null) ? (
        <div className="mt-1 flex items-center justify-between gap-2 text-[0.68rem] opacity-75">
          <span>{hint}</span>
          {delta != null ? <Delta value={delta} /> : null}
        </div>
      ) : null}
    </>
  );

  const className = cn(
    "relative overflow-hidden rounded-[8px] p-3 pl-4 text-left transition",
    toneClass,
    onClick ? "cursor-pointer hover:-translate-y-px hover:shadow-card" : "",
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}
