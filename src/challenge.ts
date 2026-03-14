// Characters that avoid visual ambiguity (no O/0, I/1, S/5, etc.)
const NONCE_CHARS = "ABCDEFGHJKLMNPQRTUVWXY2346789";

export function generateNonce(length = 4): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  }
  return result;
}

export function buildChallengeRule(nonce: string, description: string): string {
  return `「${nonce}」を紙に手書きし、対象（${description}）と一緒に撮影してください。手書きの文字が写真内に写っている必要があります。C2PA対応カメラでの撮影を推奨します。`;
}
