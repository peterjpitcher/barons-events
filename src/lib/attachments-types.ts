// Shared types for attachments — safe to import from client components.
// The server-only helpers live in src/lib/attachments.ts.

export type AttachmentVersionSummary = {
  id: string;
  versionNo: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
};

export type AttachmentSummary = {
  id: string;
  originalFilename: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string | null;
  uploadedBy: string | null;
  currentVersionId: string | null;
  versionCount: number;
  versions: AttachmentVersionSummary[];
  parent: "event" | "planning_item" | "planning_task";
  parentId: string;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
