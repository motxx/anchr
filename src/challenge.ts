// Characters that avoid visual ambiguity (no O/0, I/1, S/5, etc.)
const NONCE_CHARS = "ABCDEFGHJKLMNPQRTUVWXY2346789";

export function generateNonce(length = 4): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += NONCE_CHARS[Math.floor(Math.random() * NONCE_CHARS.length)];
  }
  return result;
}

export function buildChallengeRule(type: string, nonce: string, params: Record<string, unknown>): string {
  switch (type) {
    case "photo_proof":
      return `「${nonce}」を紙に手書きし、対象物（${params.target}）と一緒に撮影してください。手書きの文字が写真内に写っている必要があります。C2PA対応カメラでの撮影を推奨します。`;

    case "store_status":
      return `「${nonce}」を紙に手書きし、店舗（${params.store_name}）の入口と一緒に撮影してください。手書きの文字が写真内に写っている必要があります。C2PA対応カメラでの撮影を推奨します。`;

    case "webpage_field":
      return `指定URLのページを開き、${params.field}を抽出してください。また「${params.anchor_word}」という語の近傍テキスト（前後20文字程度）をproof_textとして返してください。`;

    default:
      return `このジョブには「${nonce}」を回答に含めてください。`;
  }
}
