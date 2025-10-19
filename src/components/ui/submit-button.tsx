"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

type SubmitButtonProps = {
  label: string;
  pendingLabel?: string;
  formAction?: (formData: FormData) => void;
} & Omit<ButtonProps, "type" | "children">;

export function SubmitButton({ label, pendingLabel = "Please wait...", formAction, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} formAction={formAction} {...props}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
