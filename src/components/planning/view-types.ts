import type { PlanningInspirationItem, PlanningItem } from "@/lib/planning/types";

export type PlanningViewEntry =
  | {
      id: string;
      source: "planning";
      targetDate: string;
      title: string;
      status: string;
      venueLabel: string;
      planningItem: PlanningItem;
    }
  | {
      id: string;
      source: "event";
      targetDate: string;
      title: string;
      status: string;
      venueLabel: string;
      eventId: string;
      startAt: string;
    }
  | {
      id: string;
      source: "inspiration";
      targetDate: string;
      title: string;
      inspirationItem: PlanningInspirationItem;
    }
  | {
      id: string;
      source: "note";
      targetDate: string;
      title: string;
      venueLabel: string;
      noteId: string;
      startDate: string;
      endDate: string | null;
      detail: string | null;
      venueId: string;
      /** Needed by the note dialog for optimistic concurrency checks. */
      updatedAt: string;
    };
