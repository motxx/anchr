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
      return `「${nonce}」を紙かメモ画面に表示し、対象物（${params.target}）と一緒に撮影してください。撮影できない場合でも、回答のtext_answerに必ず「${nonce}」を含めてください。`;

    case "store_status":
      return `「${nonce}」を紙かメモ画面に表示し、店舗（${params.store_name}）の入口と一緒に撮影してください。回答のnotesに必ず「${nonce}」を含めてください。`;

    case "webpage_field":
      return `指定URLのページを開き、${params.field}を抽出してください。また「${params.anchor_word}」という語の近傍テキスト（前後20文字程度）をproof_textとして返してください。`;

    default:
      return `このジョブには「${nonce}」を回答に含めてください。`;
  }
}
