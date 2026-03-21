"use client";

import { createContext, useContext } from "react";

export type EventFormContextValue = {
  saveDraft: () => void;
  submitForReview: () => void;
  generateWebsiteCopy: () => void;
  isSaving: boolean;
  isSubmitting: boolean;
  isGenerating: boolean;
  isPending: boolean;
  mode: "create" | "edit";
  canGenerateWebsiteCopy: boolean;
  primaryLabel: string;
  secondaryLabel: string;
  showSecondaryAction: boolean;
};

export const EventFormContext = createContext<EventFormContextValue | null>(null);

export function useEventFormContext() {
  const ctx = useContext(EventFormContext);
  if (!ctx) throw new Error("useEventFormContext must be used within EventFormContext.Provider");
  return ctx;
}
