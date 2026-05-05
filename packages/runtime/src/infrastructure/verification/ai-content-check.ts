/**
 * Re-export shim during photo-bounty package extraction (2026-04-26).
 * Canonical location: packages/photo-verification/src/ai-content-check.ts
 *
 * The package version is dependency-injected (no implicit env / attachment store
 * dependency). This shim wires it up to the host's `getRuntimeConfig` and
 * `readStoredAttachmentBuffer` so existing call sites keep working unchanged.
 *
 * Will be deleted when consumers (verifier.ts, index.ts) migrate to construct
 * their own checker via `createAiContentChecker` from the package.
 */

import { createAiContentChecker } from "@anchr/photo-verification/ai-content-check";
import { getRuntimeConfig } from "../config.ts";
import { readStoredAttachmentBuffer } from "../attachments.ts";
import type { AttachmentRef } from "../../domain/types.ts";

export type { ContentCheckResult } from "@anchr/photo-verification/ai-content-check";
export { createAiContentChecker } from "@anchr/photo-verification/ai-content-check";

const checker = createAiContentChecker<AttachmentRef>({
  getConfig: () => {
    const c = getRuntimeConfig();
    return { enabled: c.aiContentCheckEnabled, anthropicApiKey: c.anthropicApiKey };
  },
  readAttachment: (ref, key) => readStoredAttachmentBuffer(ref, undefined, key),
});

export const checkAttachmentContent = checker;
