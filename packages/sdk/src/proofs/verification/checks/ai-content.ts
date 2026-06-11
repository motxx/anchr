/**
 * AI content factor: optional model-based plausibility check over photo
 * evidence, gated by AI_CONTENT_CHECK / ANTHROPIC_API_KEY at the entry
 * point of this check.
 */

import { Buffer } from "node:buffer";
import {
  type AiContentCheckConfig,
  type AiContentChecker,
  createAiContentChecker,
} from "../../ai-content-check.ts";
import type { AttachmentRef, BlossomKeyMaterial } from "../../../values.ts";
import { fetchAttachmentData } from "./photo-integrity.ts";
import type { CheckAccumulator, FactorCheck } from "./types.ts";

/** Env-gated default config: the deployment-level switch for this factor. */
export function aiContentConfigFromEnv(): AiContentCheckConfig {
  const enabled = Deno.env.get("AI_CONTENT_CHECK");
  const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  return {
    enabled: enabled === "true" || enabled === "1",
    anthropicApiKey: anthropicApiKey === "" ? undefined : anthropicApiKey,
  };
}

async function readAttachmentForAiCheck(
  ref: AttachmentRef,
  blossomKey: BlossomKeyMaterial | undefined,
) {
  const data = await fetchAttachmentData(
    ref,
    [],
    blossomKey ? { [ref.id]: blossomKey } : undefined,
  );
  if (!data) return null;
  return { data: Buffer.from(data), mimeType: ref.mime_type };
}

function makeChecker(
  getConfig: () => AiContentCheckConfig,
): AiContentChecker<AttachmentRef> {
  return createAiContentChecker<AttachmentRef>({
    getConfig,
    readAttachment: readAttachmentForAiCheck,
  });
}

export const checkAttachmentContent: AiContentChecker<AttachmentRef> =
  makeChecker(aiContentConfigFromEnv);

export const aiContentCheck: FactorCheck = {
  name: "ai-content",
  async run(ctx) {
    const attachments = ctx.input.attachments ?? [];
    if (attachments.length === 0 || ctx.acc.failures.length > 0) return;
    const aiQuery = {
      description: ctx.requirement.description ?? "",
      challenge_nonce: ctx.requirement.challenge_nonce,
      verification_requirements: ctx.requirement.factors,
    };
    const config = ctx.options.aiContent;
    const checker = config === undefined
      ? checkAttachmentContent
      : makeChecker(() => config);
    const aiResult = await checker(
      aiQuery,
      { attachments },
      ctx.options.blossomKeys,
    );
    applyAiContentResult(aiResult, ctx.acc);
  },
};

function applyAiContentResult(
  aiResult: { passed: boolean; reason: string } | null,
  acc: CheckAccumulator,
): void {
  if (!aiResult) return;
  if (aiResult.passed) {
    acc.checks.push(`AI content check passed: ${aiResult.reason}`);
  } else {
    acc.warnings.push(`AI content check failed: ${aiResult.reason}`);
  }
}
