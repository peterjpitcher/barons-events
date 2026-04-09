"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { backfillSopChecklistsAction } from "@/actions/sop";

export function SopBackfillButton() {
  const [loading, setLoading] = useState(false);

  async function handleBackfill() {
    setLoading(true);
    try {
      const result = await backfillSopChecklistsAction();
      if (result.success) {
        toast.success(result.message);
        if (result.errors.length > 0) {
          for (const err of result.errors.slice(0, 5)) {
            toast.warning(err);
          }
        }
      } else {
        toast.error(result.message ?? "Backfill failed.");
      }
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">
        Backfill SOP checklists
      </h3>
      <p className="text-xs text-[var(--color-text-muted)] mb-3">
        Generate SOP checklists for any events or planning items that don&apos;t have one yet.
        This is safe to run multiple times — items that already have checklists are skipped.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={handleBackfill}
      >
        {loading && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
        {loading ? "Running…" : "Run backfill"}
      </Button>
    </div>
  );
}
