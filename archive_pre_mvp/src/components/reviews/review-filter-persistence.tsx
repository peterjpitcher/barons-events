"use client";

import { useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const STORAGE_KEY = "reviews:filters";

type ReviewFilterPersistenceProps = {
  formId: string;
  shouldRestore: boolean;
  filterValue: string;
  reviewerValue: string;
};

export function ReviewFilterPersistence({
  formId,
  shouldRestore,
  filterValue,
  reviewerValue,
}: ReviewFilterPersistenceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const persistFilters = useCallback(
    (nextFilter: string, nextReviewer: string) => {
      if (typeof window === "undefined") {
        return;
      }

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          filter: nextFilter,
          reviewer: nextReviewer,
        })
      );

      const params = new URLSearchParams(window.location.search);
      let mutated = false;

      if (nextFilter && nextFilter !== "active") {
        if (params.get("filter") !== nextFilter) {
          params.set("filter", nextFilter);
          mutated = true;
        }
      } else if (params.has("filter")) {
        params.delete("filter");
        mutated = true;
      }

      const hasReviewerControl =
        document.getElementById("reviewer") instanceof HTMLSelectElement;

      if (hasReviewerControl) {
        if (nextReviewer && nextReviewer !== "all") {
          if (params.get("reviewer") !== nextReviewer) {
            params.set("reviewer", nextReviewer);
            mutated = true;
          }
        } else if (params.has("reviewer")) {
          params.delete("reviewer");
          mutated = true;
        }
      }

      if (mutated) {
        const nextQuery = params.toString();
        const nextUrl = nextQuery.length > 0 ? `${pathname}?${nextQuery}` : pathname;
        router.replace(nextUrl, { scroll: false });
      }
    },
    [pathname, router]
  );

  useEffect(() => {
    if (!shouldRestore) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    let parsed: { filter?: string; reviewer?: string } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    let changed = false;

    if (parsed.filter && !searchParams.get("filter")) {
      params.set("filter", parsed.filter);
      changed = true;
    }

    if (parsed.reviewer && !searchParams.get("reviewer")) {
      params.set("reviewer", parsed.reviewer);
      changed = true;
    }

    if (changed) {
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [shouldRestore, router, pathname, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) {
      return;
    }

    const handleSubmit = () => {
      const formData = new FormData(form);
      const nextFilter = String(formData.get("filter") ?? "");
      const nextReviewer = String(formData.get("reviewer") ?? "");
      persistFilters(nextFilter, nextReviewer);
    };

    form.addEventListener("submit", handleSubmit);
    return () => {
      form.removeEventListener("submit", handleSubmit);
    };
  }, [formId, persistFilters]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) {
      return;
    }

    const handleChange = () => {
      const formData = new FormData(form);
      const nextFilter = String(formData.get("filter") ?? "");
      const nextReviewer = String(formData.get("reviewer") ?? "");
      persistFilters(nextFilter, nextReviewer);
    };

    form.addEventListener("change", handleChange);
    return () => {
      form.removeEventListener("change", handleChange);
    };
  }, [formId, persistFilters]);

  useEffect(() => {
    persistFilters(filterValue, reviewerValue);
  }, [filterValue, reviewerValue, persistFilters]);

  return null;
}
