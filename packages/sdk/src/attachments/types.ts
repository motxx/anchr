import type { Buffer } from "node:buffer";
import type { AttachmentStorageKind } from "../values.ts";

export interface StoredAttachment {
  filename: string;
  mimeType: string;
  absoluteUrl: string;
  storageKind: AttachmentStorageKind;
}

export interface StoredAttachmentBuffer extends StoredAttachment {
  data: Buffer;
}

export interface StoredAttachmentStats extends StoredAttachment {
  size: number;
}
