"use client";

import { useState } from "react";
import { MoreVertical, Ban, Trash2, CheckCircle, Lock } from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DeactivateDialog } from "./deactivate-dialog";
import { DeleteDialog } from "./delete-dialog";
import { ReactivateDialog } from "./reactivate-dialog";
import type { EnrichedUser } from "@/lib/users";

type UserActionsMenuProps = {
  user: EnrichedUser;
  currentUserId: string;
};

export function UserActionsMenu({ user, currentUserId }: UserActionsMenuProps): React.ReactElement | null {
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  // Administrators are protected
  if (user.role === "administrator") {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]"
        title="Administrators cannot be deactivated or deleted"
      >
        <Lock className="h-3 w-3" aria-hidden="true" />
        Protected
      </span>
    );
  }

  // Cannot action yourself
  if (user.id === currentUserId) return null;

  const isDeactivated = Boolean(user.deactivated_at);

  return (
    <>
      <DropdownMenu trigger={<MoreVertical className="h-4 w-4" aria-label="User actions" />}>
        {isDeactivated ? (
          <DropdownMenuItem onClick={() => setReactivateOpen(true)} variant="success" icon={<CheckCircle className="h-4 w-4" />}>
            Reactivate user
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => setDeactivateOpen(true)} variant="warning" icon={<Ban className="h-4 w-4" />}>
            Deactivate user
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setDeleteOpen(true)} variant="danger" icon={<Trash2 className="h-4 w-4" />}>
          Delete user
        </DropdownMenuItem>
      </DropdownMenu>

      <DeactivateDialog open={deactivateOpen} onClose={() => setDeactivateOpen(false)} user={user} />
      <DeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} user={user} />
      <ReactivateDialog open={reactivateOpen} onClose={() => setReactivateOpen(false)} user={user} />
    </>
  );
}
