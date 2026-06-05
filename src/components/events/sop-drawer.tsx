"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SopChecklistView } from "@/components/planning/sop-checklist-view";
import { setUserPinPreferenceAction } from "@/actions/user-preferences";
import { cn } from "@/lib/utils";
import type { PlanningPerson, PlanningTask } from "@/lib/planning/types";

type SopDrawerProps = {
  tasks: PlanningTask[];
  users: PlanningPerson[];
  itemId?: string | null;
  currentUserId: string;
  readOnly?: boolean;
  initiallyPinned?: boolean;
  externalTriggerId?: string;
  title?: string;
};

export function SopDrawer({
  tasks,
  users,
  itemId,
  currentUserId,
  readOnly = false,
  initiallyPinned = false,
  externalTriggerId,
  title = "MY TODO ITEMS",
}: SopDrawerProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(initiallyPinned);
  const router = useRouter();
  const originalBodyPaddingRef = useRef<string | null>(null);
  const originalDrawerOffsetRef = useRef<string | null>(null);
  const expanded = pinned || open || hovered || focused;

  const doneCount = useMemo(
    () => tasks.filter((t) => t.status === "done").length,
    [tasks],
  );

  useEffect(() => {
    if (originalBodyPaddingRef.current === null) {
      originalBodyPaddingRef.current = document.body.style.paddingRight;
    }
    if (originalDrawerOffsetRef.current === null) {
      originalDrawerOffsetRef.current = document.documentElement.style.getPropertyValue("--sop-drawer-reserved-width");
    }

    const media = window.matchMedia("(min-width: 1024px)");
    function syncBodyPadding(): void {
      if (!media.matches) {
        document.body.style.paddingRight = "";
        document.documentElement.style.removeProperty("--sop-drawer-reserved-width");
        return;
      }

      const reservedWidth = pinned ? "28rem" : "3rem";
      document.body.style.paddingRight = reservedWidth;
      document.documentElement.style.setProperty("--sop-drawer-reserved-width", reservedWidth);
    }

    syncBodyPadding();
    media.addEventListener("change", syncBodyPadding);

    return () => {
      media.removeEventListener("change", syncBodyPadding);
      if (originalBodyPaddingRef.current !== null) {
        document.body.style.paddingRight = originalBodyPaddingRef.current;
      }
      if (originalDrawerOffsetRef.current) {
        document.documentElement.style.setProperty("--sop-drawer-reserved-width", originalDrawerOffsetRef.current);
      } else {
        document.documentElement.style.removeProperty("--sop-drawer-reserved-width");
      }
    };
  }, [pinned]);

  useEffect(() => {
    if (!externalTriggerId) return;
    const trigger = document.getElementById(externalTriggerId);
    if (!trigger) return;
    function handleClick(): void {
      setOpen(true);
    }
    trigger.addEventListener("click", handleClick);
    return () => trigger.removeEventListener("click", handleClick);
  }, [externalTriggerId]);

  function handleChanged(): void {
    router.refresh();
  }

  async function setPinnedPreference(nextPinned: boolean): Promise<void> {
    setPinned(nextPinned);
    setOpen(nextPinned);
    const result = await setUserPinPreferenceAction({
      preference: "sop_drawer_pinned",
      value: nextPinned
    });
    if (!result.success) {
      setPinned(!nextPinned);
      toast.error(result.message ?? "Could not save drawer preference.");
    } else {
      router.refresh();
    }
  }

  const checklist = tasks.length > 0 && itemId ? (readOnly ? (
    <div className="pointer-events-none opacity-80">
      <SopChecklistView
        tasks={tasks}
        users={users}
        itemId={itemId}
        currentUserId={currentUserId}
        onChanged={handleChanged}
      />
    </div>
  ) : (
    <SopChecklistView
      tasks={tasks}
      users={users}
      itemId={itemId}
      currentUserId={currentUserId}
      onChanged={handleChanged}
    />
  )) : (
    <div className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper-tint)] p-4 text-sm text-[var(--ink-muted)]">
      No SOP tasks yet.
    </div>
  );

  return (
    <aside
      className={cn(
        "fixed bottom-0 right-0 top-0 z-40 hidden flex-col border-l bg-[var(--paper)] shadow-card transition-[width] duration-200 ease-out lg:flex",
        expanded ? "w-[min(28rem,calc(100vw-3rem))] border-[var(--hair)]" : "w-12 border-[var(--mustard-dark)]"
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        if (!pinned) setOpen(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false);
          if (!pinned) setOpen(false);
        }
      }}
      aria-label={`${title} drawer`}
    >
      <div className="flex min-h-0 flex-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          tabIndex={expanded ? -1 : 0}
          aria-hidden={expanded}
          className={cn(
            "flex flex-none flex-col items-center justify-between gap-3 overflow-hidden text-white transition-[width,opacity,background-color] duration-200",
            expanded
              ? "pointer-events-none w-0 px-0 py-5 opacity-0"
              : "w-12 bg-[var(--mustard)] px-2 py-5 opacity-100 hover:bg-[var(--mustard-dark)]"
          )}
          aria-label={`Open ${title} - ${doneCount} of ${tasks.length} complete`}
        >
          <ClipboardList className="h-5 w-5 flex-none" aria-hidden="true" />
          <span
            className="min-h-0 flex-1 text-sm font-semibold tracking-[0.08em] text-white"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {title}
          </span>
          <span className="rounded-full bg-[var(--paper)]/80 px-1.5 py-0.5 text-xs font-semibold text-[var(--navy)]">
            {doneCount}/{tasks.length}
          </span>
        </button>

        <div
          className={cn(
            "min-w-0 flex-1 overflow-hidden transition-opacity duration-150",
            expanded ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          aria-hidden={!expanded}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--hair)] bg-[var(--paper)] px-5 py-3 text-[var(--ink)]">
              <div className="flex min-w-0 items-center gap-2">
                <ClipboardList className="h-4 w-4 text-subtle" aria-hidden="true" />
                <h2 className="truncate text-sm font-semibold tracking-wider" title={title}>{title}</h2>
                <span className="rounded-full bg-[var(--canvas-2)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-muted)]">{doneCount}/{tasks.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-[var(--ink-muted)] hover:bg-[var(--canvas-2)] hover:text-[var(--ink)] focus-visible:outline-[var(--navy)]"
                  onClick={() => void setPinnedPreference(!pinned)}
                  aria-label={pinned ? "Unpin todo drawer" : "Pin todo drawer"}
                  aria-pressed={pinned}
                >
                  {pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {checklist}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
