import { checkAttachmentContent } from "./ai-content-check";
import type {
  PhotoProofResult,
  Query,
  QueryResult,
  StoreStatusResult,
  VerificationDetail,
  WebpageFieldResult,
} from "./types";

export async function verify(query: Query, result: QueryResult): Promise<VerificationDetail> {
  const checks: string[] = [];
  const failures: string[] = [];

  switch (query.type) {
    case "photo_proof":
      verifyPhotoProof(result as PhotoProofResult, query.challenge_nonce, checks, failures);
      break;
    case "store_status":
      verifyStoreStatus(result as StoreStatusResult, query.challenge_nonce, checks, failures);
      break;
    case "webpage_field":
      verifyWebpageField(
        result as WebpageFieldResult,
        query.challenge_nonce,
        (query.params as { anchor_word: string }).anchor_word,
        checks,
        failures,
      );
      break;
  }

  if (query.type === "photo_proof" && failures.length === 0) {
    const aiResult = await checkAttachmentContent(query, result);
    if (aiResult) {
      if (aiResult.passed) {
        checks.push(`AI content check passed: ${aiResult.reason}`);
      } else {
        failures.push(`AI content check failed: ${aiResult.reason}`);
      }
    }
  }

  return {
    passed: failures.length === 0,
    checks,
    failures,
  };
}

function verifyPhotoProof(
  result: PhotoProofResult,
  nonce: string,
  checks: string[],
  failures: string[],
): void {
  if (!result.text_answer || result.text_answer.trim().length === 0) {
    failures.push("text_answer is empty");
  } else {
    checks.push("text_answer present");
  }

  if (result.text_answer?.includes(nonce)) {
    checks.push(`nonce "${nonce}" found in text_answer`);
  } else {
    failures.push(`nonce "${nonce}" not found in text_answer`);
  }

  if (Array.isArray(result.attachments) && result.attachments.length > 0) {
    checks.push("photo attachment present");
  } else {
    failures.push("at least one photo attachment is required");
  }

  if (result.text_answer && result.text_answer.length > 5000) {
    failures.push("text_answer too long (max 5000 chars)");
  } else {
    checks.push("text_answer length ok");
  }
}

function verifyStoreStatus(
  result: StoreStatusResult,
  nonce: string,
  checks: string[],
  failures: string[],
): void {
  if (result.status !== "open" && result.status !== "closed") {
    failures.push(`status must be "open" or "closed", got "${result.status}"`);
  } else {
    checks.push(`status is valid: "${result.status}"`);
  }

  if (!result.notes || result.notes.trim().length === 0) {
    failures.push("notes is empty");
  } else {
    checks.push("notes present");
  }

  if (result.notes?.includes(nonce)) {
    checks.push(`nonce "${nonce}" found in notes`);
  } else {
    failures.push(`nonce "${nonce}" not found in notes`);
  }
}

function verifyWebpageField(
  result: WebpageFieldResult,
  nonce: string,
  anchorWord: string,
  checks: string[],
  failures: string[],
): void {
  if (!result.answer || result.answer.trim().length === 0) {
    failures.push("answer is empty");
  } else {
    checks.push("answer present");
  }

  if (!result.proof_text || result.proof_text.trim().length === 0) {
    failures.push("proof_text is empty");
  } else {
    checks.push("proof_text present");
  }

  if (result.proof_text?.includes(anchorWord)) {
    checks.push(`anchor word "${anchorWord}" found in proof_text`);
  } else {
    failures.push(`anchor word "${anchorWord}" not found in proof_text`);
  }

  if (!result.notes || result.notes.trim().length === 0) {
    failures.push("notes is empty");
  } else {
    checks.push("notes present");
  }

  if (result.notes?.includes(nonce)) {
    checks.push(`nonce "${nonce}" found in notes`);
  } else {
    failures.push(`nonce "${nonce}" not found in notes`);
  }

  if (result.answer && result.answer.length > 2000) {
    failures.push("answer too long (max 2000 chars)");
  } else {
    checks.push("answer length ok");
  }
}
