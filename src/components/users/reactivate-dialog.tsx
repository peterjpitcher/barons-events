"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { reactivateUserAction } from "@/actions/users";
import type { EnrichedUser } from "@/lib/users";

type ReactivateDialogProps = {
  open: boolean;
  onClose: () => void;
  user: EnrichedUser;
};

export function ReactivateDialog({ open, onClose, user }: ReactivateDialogProps): React.ReactElement {
  const [submitting, setSubmitting] = useState(false);

  async function handleReactivate(): Promise<void> {
    setSubmitting(true);
    const result = await reactivateUserAction(user.id);
    setSubmitting(false);
    if (result.success) {
      toast.success(`${user.full_name ?? user.email} has been reactivated.`);
      onClose();
    } else {
      toast.error(result.error ?? "Something went wrong.");
    }
  }

  return (
    <ConfirmDialog
      open={open}
      title={`Reactivate ${user.full_name ?? user.email}?`}
      description="They will be able to log in again. Note: content that was previously reassigned will remain with the new owner."
      confirmLabel={submitting ? "Reactivating..." : "Reactivate"}
      cancelLabel="Cancel"
      variant="default"
      onConfirm={handleReactivate}
      onCancel={onClose}
    />
  );
}
