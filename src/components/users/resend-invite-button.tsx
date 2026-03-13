"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { resendInviteAction } from "@/actions/users";
import type { ActionResult } from "@/lib/types";

type ResendInviteButtonProps = {
  userId: string;
  email: string;
  fullName: string | null;
};

export function ResendInviteButton({ userId, email, fullName }: ResendInviteButtonProps) {
  const [state, formAction, isPending] = useActionState<ActionResult | undefined, FormData>(
    resendInviteAction,
    undefined
  );
  const router = useRouter();

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(`Invite resent to ${email}`);
      router.refresh();
    } else {
      toast.error(state.message);
    }
  }, [state, email, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="fullName" value={fullName ?? ""} />
      <button
        type="submit"
        disabled={isPending}
        className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline disabled:opacity-50"
      >
        <Mail className="h-3 w-3" aria-hidden="true" />
        {isPending ? "Sending…" : "Resend invite"}
      </button>
    </form>
  );
}
