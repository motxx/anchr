/**
 * FROST distributed key generation and threshold Schnorr signing: the
 * frost-signer CLI wrapper, per-node config, DKG/signing session coordinator,
 * the peer signing-round coordinator, the per-node signer, and the
 * application-port signature adapter.
 */

export {
  aggregateSignatures,
  dkgRound1,
  dkgRound2,
  dkgRound3,
  findFrostSigner,
  isFrostSignerAvailable,
  runFrostCommand,
  signRound1,
  signRound2,
  verifySignature,
} from "./frost-cli.ts";
export type { FrostCliResult } from "./frost-cli.ts";

export {
  loadFrostNodeConfig,
  saveFrostNodeConfig,
  toThresholdOracleConfig,
} from "./frost-config.ts";
export type { FrostNodeConfig, PeerConfig } from "./frost-config.ts";

export { createFrostCoordinator } from "./frost-coordinator.ts";
export type { FrostCoordinator } from "./frost-coordinator.ts";

export { coordinateSigning } from "./frost-signing-coordinator.ts";
export type {
  SigningCoordinatorConfig,
  SigningCoordinatorResult,
} from "./frost-signing-coordinator.ts";

export { createFrostSigner } from "./frost-signer.ts";
export type {
  DkgRoundInput,
  DkgRoundOutput,
  FrostSigner,
  FrostSignerConfig,
  SignerOutput,
} from "./frost-signer.ts";

export type {
  DkgRoundResult,
  DkgSession,
  FrostDkgMessage,
  FrostSigningMessage,
  FrostSigningSession,
  ThresholdOracleConfig,
} from "./frost-types.ts";

export { createFrostSignatureAdapter } from "./frost-signature-adapter.ts";

export {
  deriveFrostEscrowTokenHash,
  deriveFrostP2pkMessages,
  deriveFrostSigningMessage,
  tokenMatchesFrostP2pkLock,
} from "./signing-message.ts";
