"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ImpactSummary } from "./impact-summary";
import { getUserImpactSummary, deactivateUserAction, listReassignmentTargets } from "@/actions/users";
import type { UserImpactSummary } from "@/lib/types";
import type { EnrichedUser } from "@/lib/users";

type DeactivateDialogProps = {
  open: boolean;
  onClose: () => void;
  user: EnrichedUser;
};

export function DeactivateDialog({ open, onClose, user }: DeactivateDialogProps): React.ReactElement | null {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [summary, setSummary] = useState<UserImpactSummary | null>(null);
  const [targets, setTargets] = useState<Array<{ id: string; full_name: string | null; email: string; role: string }>>([]);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSummary(null);
    setSelectedTarget("");

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
  }, [open, user.id]);

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

  async function handleDeactivate(): Promise<void> {
    setSubmitting(true);
    const result = await deactivateUserAction(user.id, selectedTarget);
    setSubmitting(false);
    if (result.success) {
      toast.success(`${user.full_name ?? user.email} has been deactivated.`);
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
          <Ban className="h-5 w-5 text-amber-600" aria-hidden="true" />
          <h2 id={titleId} className="text-lg font-semibold text-[var(--color-text)]">
            Deactivate {user.full_name ?? user.email}
          </h2>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 mb-4">
          This user will be blocked from logging in. All their owned content will be reassigned to the user you choose below.
        </div>

        {loading ? (
          <p className="text-sm text-[var(--color-text-muted)]">Loading impact summary...</p>
        ) : summary ? (
          <ImpactSummary summary={summary} />
        ) : null}

        <div className="mt-4 space-y-2">
          <label htmlFor="reassign-target" className="block text-sm font-medium text-[var(--color-text)]">
            Reassign content to
          </label>
          <Select
            id="reassign-target"
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
            variant="primary"
            onClick={handleDeactivate}
            disabled={!selectedTarget || submitting}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {submitting ? "Deactivating..." : "Deactivate user"}
          </Button>
        </div>
      </div>
    </div>
  );
}
