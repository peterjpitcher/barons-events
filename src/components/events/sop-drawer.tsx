"use client";

import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import type { PlanningPerson, PlanningTask } from "@/lib/planning/types";

type SopDrawerProps = {
  tasks: PlanningTask[];
  users: PlanningPerson[];
  itemId: string;
  currentUserId: string;
  readOnly?: boolean;
};

export function SopDrawer({
  tasks,
  users,
  itemId,
  currentUserId,
  readOnly = false,
}: SopDrawerProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);

  const doneCount = useMemo(
    () => tasks.filter((t) => t.status === "done").length,
    [tasks],
  );

  if (tasks.length === 0) return null;

  return (
    <>
      {/* Right-edge handle — always visible when drawer is closed */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-0 top-1/2 z-40 flex -translate-y-1/2 items-center gap-1.5 rounded-l-md border border-r-0 border-[var(--color-border)] bg-white px-1.5 py-2.5 shadow-md transition-colors hover:bg-[var(--color-muted-surface)]"
          style={{ writingMode: "vertical-lr" }}
          aria-label={`Open 30/60/90 Planning — ${doneCount} of ${tasks.length} complete`}
        >
          <ClipboardList className="h-4 w-4 rotate-90" />
          <span className="text-sm font-medium text-[var(--color-text)]">
            30/60/90 Planning
          </span>
          <span className="text-xs font-semibold text-[var(--color-primary-500)]">
            {doneCount}/{tasks.length}
          </span>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex flex-col">
          <SheetHeader>
            <SheetTitle>SOP Checklist</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {readOnly ? (
              <div className="pointer-events-none opacity-80">
                <SopChecklistView
                  tasks={tasks}
                  users={users}
                  itemId={itemId}
                  currentUserId={currentUserId}
                />
              </div>
            ) : (
              <SopChecklistView
                tasks={tasks}
                users={users}
                itemId={itemId}
                currentUserId={currentUserId}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
