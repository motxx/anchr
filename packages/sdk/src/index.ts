/**
 * Anchr SDK — buy cryptographically verified data with sats.
 *
 * Public surface composes the convenience `Anchr` HTTP client (in
 * `./client.ts`) with the Customer / Provider API plus the supporting
 * Nostr / Cashu / Oracle helpers. Each domain lives in its own sibling
 * file; this barrel is intentionally a re-export only.
 */

export { Anchr } from "./client.ts";
export type {
  AnchrConfig,
  PhotoQueryOptions,
  PhotoResult,
  QueryCondition,
  QueryOptions,
  QueryResult,
} from "./client-types.ts";
export {
  AnchrError,
  QueryTimeoutError,
  VerificationFailedError,
} from "./errors.ts";

import { Anchr } from "./client.ts";
export default Anchr;

// --- v0.0.1 Customer / Provider API ---

export {
  createCustomer,
  type Customer,
  CustomerConfigError,
  DEFAULT_LOCKTIME_SECONDS,
  DEFAULT_QUOTE_WINDOW_MS,
  DEFAULT_RESULT_TIMEOUT_MS,
  generateQueryId,
  NoQuotesReceivedError,
  OracleWhitelistMismatchError,
  pickOracleForRequest,
  RelayPublishError,
  ResultTimeoutError,
  SchemaVerificationError,
  selectCheapestQuote,
  validateCustomerOptions,
} from "@anchr/customer-sdk/customer";

export {
  type AdapterCapability,
  type AdapterManifest,
  type CapabilityAdapter,
  type CapabilityCheckResult,
  checkCapabilities,
  missingCapabilities,
  type RuntimeTarget,
} from "@anchr/protocol/capabilities";

export {
  buildPreimageDeliveryEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuoteFeedbackEvent,
  buildSelectionFeedbackEvent,
  type OracleQueryResponsePayload,
  parseOracleQueryResponseEvent,
  parsePreimageDeliveryEvent,
  parseQueryRequestEvent,
  parseQueryResponseEvent,
  parseQuoteFeedbackEvent,
  parseSelectionFeedbackEvent,
  type PreimageDeliveryPayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type QuoteFeedbackPayload,
  type SelectionFeedbackPayload,
} from "@anchr/protocol/events";

export {
  createProvider,
  DEFAULT_PREIMAGE_TIMEOUT_MS,
  DEFAULT_SELECTION_TIMEOUT_MS,
  type Provider,
  ProviderConfigError,
  shouldQuote,
  validateProviderOptions,
} from "@anchr/provider-sdk/provider";

export {
  DEFINED_SCHEMAS,
  type DefinedSchemaUri,
  InvalidSchemaUriError,
  isSchemaUri,
  resolveProofGenerator,
  resolveVerifierAdapter,
  type SchemaUri,
  UnknownSchemaError,
} from "@anchr/protocol/schema";

export type {
  Payment,
  ProofGenerator,
  ProviderHandler,
  ProviderQuote,
  ProviderRequestEvent,
  Quote,
  RequestResult,
  SchemaProducer,
  SchemaProducerContext,
  SchemaVerifier,
  Spec,
  VerifierAdapter,
} from "@anchr/protocol/types";

export type {
  CustomerOptions,
  QuoteSelector,
  RequestOptions,
} from "@anchr/customer-sdk/types";

export type { ProviderOptions } from "@anchr/provider-sdk/types";

export {
  createKeypairSigner,
  createNip07Signer,
  decryptNip44,
  encryptNip44,
  findAllTagValues,
  findTagValue,
  generateKeypair,
  type Keypair,
  KIND_DIRECT_MESSAGE,
  KIND_QUERY_FEEDBACK,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  type Nip07Provider,
  Nip07UnavailableError,
  normalizePubkey,
  normalizeSecretKey,
  type NostrSigner,
  signEvent,
} from "@anchr/protocol/nostr";

export {
  createRelayClient,
  type Filter,
  type PublishResult,
  type RelayClient,
  type Subscription,
} from "@anchr/customer-sdk/nostr";

export {
  type ActorStateStore,
  createIndexedDbStateStore,
  createMemoryStateStore,
  IndexedDbStateStoreError,
  type IndexedDbStateStoreOptions,
  type MemoryStateStoreOptions,
} from "@anchr/customer-sdk/storage";

export {
  createHttpOracleClient,
  type HttpOracleOptions,
  type OracleClient,
  OracleHttpError,
  OracleResponseError,
} from "@anchr/oracle-sdk/oracle";

export {
  type BindProviderParams,
  type BuildHtlcLockParams,
  type CashuClient,
  CashuClientError,
  type CashuClientOptions,
  CashuMintError,
  type CashuProof,
  type CashuSendChain,
  type CashuToken,
  type CashuWalletAdapter,
  createCashuClient,
  type RedeemHtlcParams,
  type RedeemResult,
  validateHashHex,
  validateLocktime,
} from "@anchr/customer-sdk/cashu";
