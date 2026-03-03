"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Show a success or error toast whenever an action result arrives.
 * Replaces the useEffect + toast pattern repeated across 15+ components.
 */
export function useActionToast(state: { success: boolean; message?: string } | null | undefined) {
  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
      } else {
        toast.error(state.message);
      }
    }
  }, [state]);
}
