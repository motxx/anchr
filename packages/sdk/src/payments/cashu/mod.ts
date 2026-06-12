/**
 * Cashu Payment Lock escrow: create, bind, verify, redeem, and refund ecash
 * locked to a query via HTLC (NUT-14) or 2-of-2 P2PK (NUT-11), plus the
 * wallet, wallet-store, and HTLC preimage release material that back it.
 */

export {
  buildEscrowP2PKOptions,
  calculateOracleFee,
  createEscrowToken,
  createHtlcToken,
  executeEscrowSwap,
  inspectEscrowToken,
  redeemHtlcToken,
  swapHtlcBindProvider,
  verifyHtlcProofs,
} from "./cashu-escrow.ts";
export type { EscrowParams, EscrowToken, SwapResult } from "./cashu-escrow.ts";

export {
  buildHtlcFinalOptions,
  buildHtlcInitialOptions,
  buildHtlcPreselectionOptions,
} from "./cashu-htlc-options.ts";
export type {
  HtlcInitialLockParams,
  HtlcPreselectionLockParams,
  HtlcProviderBindParams,
} from "./cashu-htlc-options.ts";

export {
  computeNetAmount,
  encodeProofs,
  getWalletAndConfig,
  loadAndSend,
  sumProofAmounts,
} from "./cashu-escrow-helpers.ts";

export { redeemSignedProofs } from "./redeem-swap.ts";
export type {
  CashuRedeemSendChain,
  CashuRedeemWallet,
  RedeemSwapFailureReason,
  RedeemSwapResult,
} from "./redeem-swap.ts";

export { createCashuEscrowProvider } from "./cashu-escrow-provider.ts";
export type { CashuEscrowProviderConfig } from "./cashu-escrow-provider.ts";

export {
  appendFrostP2PKGroupSignatures,
  buildFrostP2PKOptions,
  createFrostEscrowProvider,
  redeemFrostP2PKToken,
} from "./frost-escrow-provider.ts";
export type {
  FrostEscrowConfig,
  FrostP2pkRedeemResult,
} from "./frost-escrow-provider.ts";

export {
  createBountyToken,
  encodeToken,
  getCashuConfig,
  getCashuWallet,
  isCashuEnabled,
  verifyToken,
} from "./cashu-wallet.ts";
export type { CashuConfig, CreateBountyTokenOptions } from "./cashu-wallet.ts";

export { createWalletStore } from "./wallet-store.ts";
export type { WalletBalance, WalletRole, WalletStore } from "./wallet-store.ts";

export {
  createPersistentPreimageStore,
  createPreimageStore,
  issueQueryHash,
} from "./preimage-store.ts";
export type { PreimageEntry, PreimageStore } from "./preimage-store.ts";
