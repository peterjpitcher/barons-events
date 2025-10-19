"use client";

import { useFormStatus } from "react-dom";
import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";

type SubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  formAction?: (formData: FormData) => void;
  icon?: ReactNode;
  pendingIcon?: ReactNode;
  hideLabel?: boolean;
} & Omit<ButtonProps, "type" | "children">;

export function SubmitButton({
  label,
  pendingLabel = "Please wait...",
  formAction,
  icon,
  pendingIcon,
  hideLabel = false,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const activeIcon = pending ? pendingIcon ?? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon;
  const labelContent = hideLabel ? <span className="sr-only">{label}</span> : label;
  const pendingContent = hideLabel ? <span className="sr-only">{pendingLabel}</span> : pendingLabel;

  return (
    <Button type="submit" disabled={pending} formAction={formAction} {...props}>
      {activeIcon ? <span className="flex items-center justify-center">{activeIcon}</span> : null}
      {pending ? pendingContent : labelContent}
    </Button>
  );
}
