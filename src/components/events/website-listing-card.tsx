import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";

type WebsiteListingCardProps = {
  websiteFields: ReactNode;
  generateAction: string | ((formData: FormData) => void);
  canGenerate: boolean;
  readOnly?: boolean;
};

export function WebsiteListingCard({
  websiteFields,
  generateAction,
  canGenerate,
  readOnly = false,
}: WebsiteListingCardProps): ReactNode {
  return (
    <Card>
      <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--navy)] px-6 py-3">
        <span className="text-sm font-semibold uppercase tracking-wider text-white">
          Website Listing
        </span>
      </CardHeader>

      <CardContent className="space-y-4">
        {websiteFields}

        {!readOnly && (
          <div className="rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--paper-tint)] p-4">
            <p className="mb-3 text-sm text-subtle">
              {canGenerate
                ? "Generate website copy from this event’s details using AI."
                : "Approve the event to enable AI generation."}
            </p>
            <SubmitButton
              label="Generate with AI"
              pendingLabel="Generating..."
              formAction={typeof generateAction === "string" ? undefined : generateAction}
              icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              variant="secondary"
              disabled={!canGenerate}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
