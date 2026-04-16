"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ImpactSummary } from "./impact-summary";
import { getUserImpactSummary, deleteUserAction, listReassignmentTargets } from "@/actions/users";
import type { UserImpactSummary } from "@/lib/types";
import type { EnrichedUser } from "@/lib/users";

type DeleteDialogProps = {
  open: boolean;
  onClose: () => void;
  user: EnrichedUser;
};

export function DeleteDialog({ open, onClose, user }: DeleteDialogProps): React.ReactElement | null {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [summary, setSummary] = useState<UserImpactSummary | null>(null);
  const [targets, setTargets] = useState<Array<{ id: string; full_name: string | null; email: string; role: string }>>([]);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const expectedName = user.full_name ?? user.email;
  const nameMatches = confirmName.trim().toLowerCase() === expectedName.trim().toLowerCase() ||
    confirmName.trim().toLowerCase() === user.email.trim().toLowerCase();

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setLoading(true);
    setSummary(null);
    setSelectedTarget("");
    setConfirmName("");

    Promise.all([
      getUserImpactSummary(user.id),
      listReassignmentTargets(user.id),
    ]).then(([impactResult, targetList]) => {
      if (impactResult.data) setSummary(impactResult.data);
      setTargets(targetList);
      setLoading(false);
    }).catch(() => {
      toast.error("Failed to load user data.");
      setLoading(false);
    });
  }, [open, user.id, user.email]);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", handleKey); };
  }, [open, onClose]);

  if (!open) return null;

  const selectedTargetName = targets.find((t) => t.id === selectedTarget);

  async function handleDelete(): Promise<void> {
    setSubmitting(true);
    const result = await deleteUserAction(user.id, selectedTarget, confirmName);
    setSubmitting(false);
    if (result.success) {
      toast.success(`${user.full_name ?? user.email} has been permanently deleted.`);
      onClose();
    } else {
      toast.error(result.error ?? "Something went wrong.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(12,20,28,0.55)] p-4" onClick={onClose} role="presentation">
      <div
        className="w-full max-w-lg rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-6 shadow-soft"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="h-5 w-5 text-red-600" aria-hidden="true" />
          <h2 id={titleId} className="text-lg font-semibold text-[var(--color-text)]">
            Delete {user.full_name ?? user.email}
          </h2>
        </div>

        {step === 1 ? (
          <>
            {loading ? (
              <p className="text-sm text-[var(--color-text-muted)]">Loading impact summary...</p>
            ) : summary ? (
              <ImpactSummary summary={summary} />
            ) : null}

            <div className="mt-4 space-y-2">
              <label htmlFor="delete-reassign-target" className="block text-sm font-medium text-[var(--color-text)]">
                Reassign content to
              </label>
              <Select
                id="delete-reassign-target"
                value={selectedTarget}
                onChange={(e) => setSelectedTarget(e.target.value)}
              >
                <option value="">Select a user...</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name ?? t.email} ({t.role === "administrator" ? "Administrator" : "Office Worker"})
                  </option>
                ))}
              </Select>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button ref={cancelRef} variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => setStep(2)}
                disabled={!selectedTarget}
              >
                Next
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text)]">
                Reassigning all content to <strong>{selectedTargetName?.full_name ?? selectedTargetName?.email}</strong>.
              </p>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                This action is permanent. The user account will be completely removed and cannot be recovered.
              </div>
              <div className="space-y-2">
                <label htmlFor="confirm-name" className="block text-sm font-medium text-[var(--color-text)]">
                  Type <code className="rounded bg-[var(--color-muted-surface)] px-1 py-0.5 text-xs">{expectedName}</code> to confirm
                </label>
                <Input
                  id="confirm-name"
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={expectedName}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={!nameMatches || submitting}
                aria-disabled={!nameMatches}
              >
                {submitting ? "Deleting..." : "Delete user permanently"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
