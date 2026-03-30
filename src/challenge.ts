import { randomBytes } from "node:crypto";

// Characters that avoid visual ambiguity (no O/0, I/1, S/5, etc.)
const NONCE_CHARS = "ABCDEFGHJKLMNPQRTUVWXY2346789";

export function generateNonce(length = 6): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += NONCE_CHARS[bytes[i]! % NONCE_CHARS.length];
  }
  return result;
}

export function buildChallengeRule(nonce: string | undefined, description: string): string {
  if (!nonce) {
    return `対象（${description}）を撮影してください。C2PA対応カメラでの撮影を推奨します。`;
  }
  return `「${nonce}」を紙に手書きし、対象（${description}）と一緒に撮影してください。手書きの文字が写真内に写っている必要があります。C2PA対応カメラでの撮影を推奨します。`;
}
