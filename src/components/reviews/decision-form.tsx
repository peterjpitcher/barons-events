"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { reviewerDecisionAction } from "@/actions/events";
import { SubmitButton } from "@/components/ui/submit-button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/ui/field-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const decisions = [
  { value: "approved", label: "Approve" },
  { value: "needs_revisions", label: "Needs tweaks" },
  { value: "rejected", label: "Reject" }
];

type DecisionFormProps = {
  eventId: string;
};

export function DecisionForm({ eventId }: DecisionFormProps) {
  const [state, formAction] = useActionState(reviewerDecisionAction, undefined);
  const [selectedDecision, setSelectedDecision] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const generateWebsiteCopyInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmBypassRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const decisionError = state?.fieldErrors?.decision;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767.98px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (state?.message) {
      if (state.success) {
        toast.success(state.message);
      } else if (!state.fieldErrors) {
        toast.error(state.message);
      }
    }
  }, [state]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (generateWebsiteCopyInputRef.current) {
      generateWebsiteCopyInputRef.current.value = "false";
    }

    if (selectedDecision !== "approved") return;

    if (confirmBypassRef.current) {
      confirmBypassRef.current = false;
      if (generateWebsiteCopyInputRef.current) {
        generateWebsiteCopyInputRef.current.value = "true";
      }
      return;
    }

    event.preventDefault();
    setConfirmOpen(true);
  }

  function handleApproveConfirm() {
    setConfirmOpen(false);
    confirmBypassRef.current = true;
    if (generateWebsiteCopyInputRef.current) {
      generateWebsiteCopyInputRef.current.value = "true";
    }
    formRef.current?.requestSubmit();
  }

  return (
    <>
      <form ref={formRef} action={formAction} className="space-y-4" noValidate onSubmit={handleSubmit}>
        <input type="hidden" name="eventId" value={eventId} />
        <input ref={generateWebsiteCopyInputRef} type="hidden" name="generateWebsiteCopy" value="false" />
        <fieldset className="space-y-2" aria-describedby={decisionError ? "decision-error" : undefined}>
          <Label className="text-sm font-semibold text-[var(--ink)]">Decision</Label>
          <div className="mobile-scroll-row md:flex md:flex-wrap md:gap-3">
            {decisions.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium text-[var(--ink)] shadow-card hover:border-[var(--slate)]",
                  selectedDecision === option.value
                    ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                    : "border-[var(--hair)] bg-[var(--paper)]"
                )}
              >
                <input
                  type="radio"
                  name="decision"
                  value={option.value}
                  className="h-4 w-4 accent-[var(--navy)]"
                  required
                  aria-invalid={Boolean(decisionError)}
                  aria-describedby={decisionError ? "decision-error" : undefined}
                  onChange={() => setSelectedDecision(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <FieldError id="decision-error" message={decisionError} />
        </fieldset>
        <div className="space-y-2">
          <Label htmlFor="feedback">Feedback (optional)</Label>
          <Textarea id="feedback" name="feedback" rows={4} placeholder="Share clear next steps or approval notes." className="text-[16px] md:text-sm" />
        </div>
        <SubmitButton label="Record decision" pendingLabel="Saving..." variant="primary" className="h-11 w-full md:w-auto" />
      </form>
      {isMobile ? (
        <Sheet open={confirmOpen} onOpenChange={setConfirmOpen}>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Approve event?</SheetTitle>
            </SheetHeader>
            <p className="px-5 pt-4 text-sm text-[var(--ink-muted)]">
              Approving this event will generate website listing copy.
            </p>
            <div className="flex gap-2 px-5 pb-5 pt-5">
              <SheetClose className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] border border-[var(--hair)] text-sm font-semibold text-[var(--ink)]">
                Cancel
              </SheetClose>
              <button type="button" className="inline-flex h-11 flex-1 items-center justify-center rounded-[8px] bg-[var(--navy)] text-sm font-semibold text-white" onClick={handleApproveConfirm}>
                Approve
              </button>
            </div>
          </SheetContent>
        </Sheet>
      ) : (
        <ConfirmDialog
          open={confirmOpen}
          title="Approve with AI copy generation?"
          description="Approving this event will generate AI website listing copy. Continue?"
          confirmLabel="Approve"
          onConfirm={handleApproveConfirm}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
