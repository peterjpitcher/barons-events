"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deletePlanningItemAction } from "@/actions/planning";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type DeletePlanningItemButtonProps = {
  itemId: string;
};

export function DeletePlanningItemButton({ itemId }: DeletePlanningItemButtonProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm(): void {
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await deletePlanningItemAction({ itemId });
      if (!result.success) {
        toast.error(result.message ?? "Could not delete planning item.");
        return;
      }

      toast.success(result.message ?? "Planning item deleted.");
      router.push("/planning");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2Icon className="mr-2 h-4 w-4" />
        {isPending ? "Deleting..." : "Delete planning item"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this planning item?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
