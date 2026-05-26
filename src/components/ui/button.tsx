import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement
} from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "subtle" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

const baseClass =
  "inline-flex items-center justify-center gap-2 rounded-[7px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mustard)] disabled:pointer-events-none disabled:opacity-60";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border border-[var(--navy)] bg-[var(--navy)] text-white hover:bg-[var(--navy-700)]",
  secondary:
    "border border-[var(--mustard)] bg-[var(--mustard)] text-[var(--ink-on-mustard)] hover:bg-[var(--mustard-bright)]",
  outline:
    "border border-[var(--hair)] bg-[var(--paper)] text-[var(--ink-muted)] hover:border-[var(--hair-strong)] hover:bg-[var(--paper-tint)] hover:text-[var(--ink)]",
  ghost:
    "border border-transparent bg-transparent text-[var(--ink-muted)] hover:bg-[var(--paper-tint)] hover:text-[var(--ink)]",
  subtle:
    "border border-transparent bg-[var(--paper-tint)] text-[var(--navy)] hover:bg-[var(--canvas-2)]",
  destructive:
    "border border-[var(--burgundy)] bg-[var(--burgundy)] text-white hover:bg-[var(--burgundy-dark)]"
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-sm",
  icon: "h-8 w-8"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", asChild = false, children, ...props }, ref) => {
    const classes = cn(baseClass, variantClass[variant], sizeClass[size], className);

    if (asChild && isValidElement(children)) {
      const child = children as ReactElement<{ className?: string }>;
      const mergedProps = {
        ...props,
        className: cn(classes, child.props.className),
        ref
      } as Partial<typeof child.props>;

      return cloneElement(child, mergedProps);
    }

    return (
      <button ref={ref} type={type} className={classes} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
