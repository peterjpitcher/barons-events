import { cn } from "@/lib/utils";

type FieldErrorProps = {
  id: string;
  message?: string | null;
  className?: string;
};

export function FieldError({ id, message, className }: FieldErrorProps) {
  if (!message) return null;

  return (
    <p
      id={id}
      role="alert"
      className={cn("text-xs text-[var(--color-danger)]", className)}
    >
      {message}
    </p>
  );
}

