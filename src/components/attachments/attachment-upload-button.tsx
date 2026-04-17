"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  confirmAttachmentUploadAction,
  requestAttachmentUploadAction,
  type RequestAttachmentUploadResult
} from "@/actions/attachments";

type ParentType = "event" | "planning_item" | "planning_task";

type AttachmentUploadButtonProps = {
  parentType: ParentType;
  parentId: string;
  /** Called after a successful upload so the parent can refetch the list. */
  onUploaded?: () => void;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
};

// 250 MB cap — keep in sync with src/actions/attachments.ts.
const MAX_BYTES = 262_144_000;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "video/mp4",
  "video/quicktime"
]);

export function AttachmentUploadButton({
  parentType,
  parentId,
  onUploaded,
  label = "Attach file",
  variant = "ghost"
}: AttachmentUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [progress, setProgress] = useState<number | null>(null);

  function handleClick() {
    inputRef.current?.click();
  }

  async function uploadWithProgress(url: string, file: File): Promise<Response> {
    // XMLHttpRequest for progress events; fetch doesn't expose upload progress.
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          setProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(new Response(null, { status: xhr.status }));
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload failed — network error."));
      xhr.send(file);
    });
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Always clear so selecting the same file twice re-fires the change event.
    if (event.target) event.target.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      toast.error("File too large. 250 MB max.");
      return;
    }
    if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
      toast.error("That file type is not allowed.");
      return;
    }

    startTransition(async () => {
      setProgress(0);
      let result: RequestAttachmentUploadResult;
      try {
        result = await requestAttachmentUploadAction({
          parentType,
          parentId,
          originalFilename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size
        });
      } catch (error) {
        console.error("requestAttachmentUploadAction threw:", error);
        setProgress(null);
        toast.error("Could not start upload.");
        return;
      }

      if (!result.success) {
        setProgress(null);
        toast.error(result.message);
        return;
      }

      try {
        await uploadWithProgress(result.uploadUrl, file);
      } catch (error) {
        console.error("attachment upload PUT failed:", error);
        setProgress(null);
        toast.error("Upload failed.");
        return;
      }

      const form = new FormData();
      form.set("attachmentId", result.attachmentId);
      const confirmResult = await confirmAttachmentUploadAction(undefined, form);
      setProgress(null);

      if (!confirmResult.success) {
        toast.error(confirmResult.message ?? "Could not verify upload.");
        return;
      }

      toast.success("File attached.");
      onUploaded?.();
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        onChange={handleChange}
        disabled={isPending}
      />
      <Button type="button" variant={variant} size="sm" onClick={handleClick} disabled={isPending}>
        <Paperclip className="mr-1 h-4 w-4" aria-hidden="true" />
        {isPending
          ? progress != null
            ? `Uploading ${progress}%`
            : "Uploading…"
          : label}
      </Button>
    </>
  );
}
