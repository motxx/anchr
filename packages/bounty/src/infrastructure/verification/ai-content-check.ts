/**
 * Host-bound AI content checker adapter. The package implementation is
 * dependency-injected; this file supplies bounty config and attachment storage.
 */

import {
  type AiContentChecker,
  createAiContentChecker,
} from "@anchr/photo-verification/ai-content-check";
import { getRuntimeConfig } from "../config.ts";
import { readStoredAttachmentBuffer } from "../attachments.ts";
import type { AttachmentRef } from "../../domain/types.ts";

export type { ContentCheckResult } from "@anchr/photo-verification/ai-content-check";
export { createAiContentChecker } from "@anchr/photo-verification/ai-content-check";

const checker: AiContentChecker<AttachmentRef> = createAiContentChecker<
  AttachmentRef
>({
  getConfig: () => {
    const c = getRuntimeConfig();
    return {
      enabled: c.aiContentCheckEnabled,
      anthropicApiKey: c.anthropicApiKey,
    };
  },
  readAttachment: (ref, key) => readStoredAttachmentBuffer(ref, undefined, key),
});

export const checkAttachmentContent = checker;
