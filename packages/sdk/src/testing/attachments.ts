import type { AttachmentRef, QueryResult } from "../requests/domain/types.ts";

type AttachmentLike = AttachmentRef | string;

function inferAttachmentId(value: string): string {
  try {
    const pathname = new URL(value).pathname;
    return pathname.split("/").filter(Boolean).pop() ?? value;
  } catch {
    return value.split("/").filter(Boolean).pop() ?? value;
  }
}

function normalizeAttachmentRef(ref: AttachmentLike): AttachmentRef {
  if (typeof ref === "string") {
    return {
      id: inferAttachmentId(ref),
      uri: ref,
      mime_type: "application/octet-stream",
      storage_kind: "external",
    };
  }

  return {
    ...ref,
    id: ref.id || inferAttachmentId(ref.uri),
    mime_type: ref.mime_type || "application/octet-stream",
    storage_kind: ref.storage_kind || "external",
  };
}

export function normalizeQueryResult(result: QueryResult): QueryResult {
  if (!result.attachments?.length) return result;
  return {
    ...result,
    attachments: result.attachments.map(normalizeAttachmentRef),
  };
}
