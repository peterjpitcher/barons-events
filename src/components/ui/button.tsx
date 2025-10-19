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
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(39,54,64,0.35)] disabled:pointer-events-none disabled:opacity-60";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-[var(--color-primary-foreground)] shadow-soft hover:bg-[var(--color-primary-800)]",
  secondary:
    "bg-secondary text-secondary-foreground shadow-soft hover:bg-[var(--color-accent-soft-dark)]",
  outline:
    "border border-[var(--color-border)] bg-white text-[var(--color-primary-700)] hover:border-[var(--color-primary-500)] hover:bg-[rgba(39,54,64,0.08)]",
  ghost:
    "bg-transparent text-[var(--color-primary-700)] hover:bg-[rgba(39,54,64,0.12)] hover:text-[var(--color-primary-900)]",
  subtle:
    "bg-[var(--color-muted-surface)] text-[var(--color-primary-700)] shadow-soft hover:bg-[var(--color-accent-soft)]",
  destructive:
    "bg-[var(--color-danger)] text-white shadow-soft hover:bg-[#dc2626]"
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-10 px-5 text-[0.95rem]",
  lg: "h-12 px-6 text-base",
  icon: "h-10 w-10"
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
