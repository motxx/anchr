/**
 * Host-bound AI content checker adapter. The package implementation is
 * dependency-injected; this file supplies bounty config and attachment storage.
 */

import {
  type AiContentChecker,
  createAiContentChecker,
} from "@anchr/sdk/proofs";
import { getRuntimeConfig } from "../config.ts";
import { readStoredAttachmentBuffer } from "../attachments.ts";
import type { AttachmentRef } from "../../../../sdk/src/requests/domain/types.ts";

export type { ContentCheckResult } from "@anchr/sdk/proofs";
export { createAiContentChecker } from "@anchr/sdk/proofs";

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
