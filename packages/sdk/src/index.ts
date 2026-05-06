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
  selectCheapestQuote,
  pickOracleForRequest,
  validateCustomerOptions,
  generateQueryId,
  CustomerConfigError,
  NoQuotesReceivedError,
  OracleWhitelistMismatchError,
  RelayPublishError,
  ResultTimeoutError,
  SchemaVerificationError,
  DEFAULT_LOCKTIME_SECONDS,
  DEFAULT_QUOTE_WINDOW_MS,
  DEFAULT_RESULT_TIMEOUT_MS,
  type Customer,
} from "./customer.ts";

export {
  buildPreimageDeliveryEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildQuoteFeedbackEvent,
  buildSelectionFeedbackEvent,
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
  validateProviderOptions,
  shouldQuote,
  ProviderConfigError,
  DEFAULT_PREIMAGE_TIMEOUT_MS,
  DEFAULT_SELECTION_TIMEOUT_MS,
  type Provider,
} from "./provider.ts";

export {
  DEFINED_SCHEMAS,
  isSchemaUri,
  resolveProducer,
  resolveVerifier,
  UnknownSchemaError,
  InvalidSchemaUriError,
  type SchemaUri,
  type DefinedSchemaUri,
} from "./schema.ts";

export type {
  Spec,
  Payment,
  RequestResult,
  Quote,
  QuoteSelector,
  CustomerOptions,
  ProviderOptions,
  RequestOptions,
  ProviderRequestEvent,
  ProviderHandler,
  ProviderQuote,
  SchemaProducer,
  SchemaVerifier,
  SchemaProducerContext,
} from "./types.ts";

export {
  KIND_DIRECT_MESSAGE,
  KIND_QUERY_FEEDBACK,
  KIND_QUERY_REQUEST,
  KIND_QUERY_RESPONSE,
  createRelayClient,
  decryptNip44,
  encryptNip44,
  findAllTagValues,
  findTagValue,
  generateKeypair,
  normalizePubkey,
  normalizeSecretKey,
  publishOnce,
  signEvent,
  type Filter,
  type Keypair,
  type PublishResult,
  type RelayClient,
  type Subscription,
} from "./nostr.ts";

export {
  createHttpOracleClient,
  OracleHttpError,
  OracleResponseError,
  type HttpOracleOptions,
  type OracleClient,
} from "./oracle.ts";

export {
  createCashuClient,
  validateHashHex,
  validateLocktime,
  CashuClientError,
  CashuMintError,
  type BindProviderParams,
  type BuildHtlcLockParams,
  type CashuClient,
  type CashuClientOptions,
  type CashuProof,
  type CashuSendChain,
  type CashuWalletAdapter,
  type CashuToken,
  type RedeemHtlcParams,
  type RedeemResult,
} from "./cashu.ts";
