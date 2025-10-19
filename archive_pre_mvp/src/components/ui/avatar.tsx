import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type AvatarProps = {
  name?: string | null;
  initials?: string;
} & HTMLAttributes<HTMLDivElement>;

const initialsFromName = (name?: string | null) => {
  if (!name) return "";
  const segments = name.trim().split(/\s+/);
  if (segments.length === 0) return "";
  if (segments.length === 1) return segments[0].slice(0, 2).toUpperCase();
  return `${segments[0][0] ?? ""}${segments[segments.length - 1][0] ?? ""}`.toUpperCase();
};

export function Avatar({ className, name, initials, children, ...props }: AvatarProps) {
  const derivedInitials = initials ?? initialsFromName(name);
  return (
    <div
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(39,54,64,0.1)] text-sm font-semibold text-[var(--color-primary-900)]",
        className
      )}
      aria-label={name ?? undefined}
      {...props}
    >
      {children ?? derivedInitials}
    </div>
  );
}

