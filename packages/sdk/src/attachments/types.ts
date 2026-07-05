import type { AttachmentStorageKind } from "../values.ts";

export interface StoredAttachment {
  filename: string;
  mimeType: string;
  absoluteUrl: string;
  storageKind: AttachmentStorageKind;
}
