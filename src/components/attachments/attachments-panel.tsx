"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AttachmentUploadButton } from "@/components/attachments/attachment-upload-button";
import { AttachmentList } from "@/components/attachments/attachment-list";
import type { AttachmentSummary } from "@/lib/attachments-types";

type AttachmentsPanelProps = {
  parentType: "event" | "planning_item" | "planning_task";
  parentId: string;
  attachments: AttachmentSummary[];
  /** Whether the viewer may upload new attachments to this parent. */
  canUpload: boolean;
  /** Viewer ID — used to compare against uploaded_by for delete visibility. */
  viewerId: string;
  /** True when the viewer is an administrator (full delete rights). */
  isAdmin: boolean;
  title?: string;
  description?: string;
  /** When true, the heading is hidden (for in-row embedding). */
  compact?: boolean;
};

/**
 * Client wrapper that bundles the upload button and list with a router.refresh
 * callback so server-side data reloads after mutations. Accepts server-
 * prefetched attachments to avoid a client round-trip on first render.
 */
export function AttachmentsPanel({
  parentType,
  parentId,
  attachments,
  canUpload,
  viewerId,
  isAdmin,
  title = "Attachments",
  description,
  compact = false
}: AttachmentsPanelProps) {
  const router = useRouter();

  const canDelete = (attachment: AttachmentSummary) =>
    isAdmin || attachment.uploadedBy === viewerId;

  const body = (
    <div className="space-y-3">
      {canUpload ? (
        <AttachmentUploadButton
          parentType={parentType}
          parentId={parentId}
          onUploaded={() => router.refresh()}
        />
      ) : null}
      <AttachmentList
        attachments={attachments}
        canDelete={canDelete}
        onChanged={() => router.refresh()}
      />
    </div>
  );

  if (compact) return body;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
