"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { addSltMemberAction, removeSltMemberAction } from "@/actions/slt";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type UserOption = { id: string; name: string; email: string };

type SltMembersManagerProps = {
  members: UserOption[];
  candidates: UserOption[];
};

export function SltMembersManager({ members, candidates }: SltMembersManagerProps) {
  const [selected, setSelected] = useState("");
  const [isPending, startTransition] = useTransition();

  const memberIds = new Set(members.map((m) => m.id));
  const availableCandidates = candidates.filter((c) => !memberIds.has(c.id));

  function runAction(action: () => Promise<unknown>, successMessage: string) {
    startTransition(async () => {
      const result = (await action()) as { success?: boolean; message?: string } | undefined;
      if (result?.success === false) {
        toast.error(result.message ?? "Could not update SLT.");
        return;
      }
      toast.success(successMessage);
      setSelected("");
    });
  }

  function handleAdd() {
    if (!selected) {
      toast.error("Select a user to add.");
      return;
    }
    const fd = new FormData();
    fd.set("userId", selected);
    runAction(() => addSltMemberAction(undefined, fd), "SLT member added.");
  }

  function handleRemove(userId: string) {
    const fd = new FormData();
    fd.set("userId", userId);
    runAction(() => removeSltMemberAction(undefined, fd), "SLT member removed.");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label htmlFor="slt-add" className="text-sm font-medium">
            Add SLT member
          </label>
          <Select
            id="slt-add"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            disabled={isPending || availableCandidates.length === 0}
          >
            <option value="">
              {availableCandidates.length === 0
                ? "No eligible users to add"
                : "Select a user..."}
            </option>
            {availableCandidates.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.email})
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" onClick={handleAdd} disabled={isPending || !selected}>
          <UserPlus className="mr-1 h-4 w-4" aria-hidden="true" /> Add
        </Button>
      </div>

      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-[var(--color-text)]">Current SLT members</h4>
        {members.length === 0 ? (
          <p className="text-sm text-subtle">No SLT members yet. Add users above to receive debrief notifications.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius-sm)] border border-[var(--color-border)]">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">{member.name}</p>
                  <p className="text-xs text-subtle">{member.email}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleRemove(member.id)}
                  aria-label={`Remove ${member.name} from SLT`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-subtle">
        SLT members receive a BCC'd email whenever a debrief is submitted.
      </p>
    </div>
  );
}
