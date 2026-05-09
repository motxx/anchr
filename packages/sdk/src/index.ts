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
} from "./customer.ts";

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
} from "./events.ts";

export {
  createProvider,
  DEFAULT_PREIMAGE_TIMEOUT_MS,
  DEFAULT_SELECTION_TIMEOUT_MS,
  type Provider,
  ProviderConfigError,
  shouldQuote,
  validateProviderOptions,
} from "./provider.ts";

export {
  DEFINED_SCHEMAS,
  type DefinedSchemaUri,
  InvalidSchemaUriError,
  isSchemaUri,
  resolveProducer,
  resolveProofGenerator,
  resolveVerifier,
  resolveVerifierAdapter,
  type SchemaUri,
  UnknownSchemaError,
} from "./schema.ts";

export type {
  CustomerOptions,
  Payment,
  ProofGenerator,
  ProviderHandler,
  ProviderOptions,
  ProviderQuote,
  ProviderRequestEvent,
  Quote,
  QuoteSelector,
  RequestOptions,
  RequestResult,
  SchemaProducer,
  SchemaProducerContext,
  SchemaVerifier,
  SchemaVerifierRegistry,
  Spec,
  VerifierAdapter,
} from "./types.ts";

export {
  createRelayClient,
  decryptNip44,
  encryptNip44,
  type Filter,
  findAllTagValues,
  findTagValue,
  generateKeypair,
  type Keypair,
  KIND_DIRECT_MESSAGE,
  KIND_QUERY_FEEDBACK,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  normalizePubkey,
  normalizeSecretKey,
  publishOnce,
  type PublishResult,
  type RelayClient,
  signEvent,
  type Subscription,
} from "./nostr.ts";

export {
  createHttpOracleClient,
  type HttpOracleOptions,
  type OracleClient,
  OracleHttpError,
  OracleResponseError,
} from "./oracle.ts";

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
} from "./cashu.ts";
