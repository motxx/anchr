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
  HttpRequestOptions,
  HttpRequestResult,
  PhotoRequestOptions,
  PhotoResult,
  RequestCondition,
} from "./client-types.ts";
export {
  AnchrError,
  RequestTimeoutError,
  VerificationFailedError,
} from "./errors.ts";

import { Anchr } from "./client.ts";
export default Anchr;

export {
  createCustomer,
  type Customer,
  CustomerConfigError,
  DEFAULT_LOCKTIME_SECONDS,
  DEFAULT_OFFER_WINDOW_MS,
  DEFAULT_RESULT_TIMEOUT_MS,
  generateQueryId,
  NoOffersReceivedError,
  pickOracleForRequest,
  RelayPublishError,
  ResultTimeoutError,
  SchemaVerificationError,
  selectCheapestOffer,
  validateCustomerOptions,
} from "./customer.ts";

export {
  type AdapterCapability,
  type AdapterManifest,
  type CapabilityAdapter,
  type CapabilityCheckResult,
  checkCapabilities,
  missingCapabilities,
  type RuntimeTarget,
} from "./adapters/types.ts";

export {
  buildOfferFeedbackEvent,
  buildPreimageDeliveryEvent,
  buildQueryRequestEvent,
  buildQueryResponseEvent,
  buildSelectionFeedbackEvent,
  type OfferFeedbackPayload,
  type OracleQueryResponsePayload,
  parseOfferFeedbackEvent,
  parseOracleQueryResponseEvent,
  parsePreimageDeliveryEvent,
  parseQueryRequestEvent,
  parseQueryResponseEvent,
  parseSelectionFeedbackEvent,
  type PreimageDeliveryPayload,
  type QueryRequestPayload,
  type QueryResponsePayload,
  type SelectionFeedbackPayload,
} from "@anchr/protocol/events";

export {
  canOfferForRequest,
  createProvider,
  DEFAULT_PREIMAGE_TIMEOUT_MS,
  DEFAULT_SELECTION_TIMEOUT_MS,
  type Provider,
  ProviderConfigError,
  validateProviderOptions,
} from "./provider.ts";

export {
  DEFINED_SCHEMAS,
  type DefinedSchemaUri,
  InvalidSchemaUriError,
  isSchemaUri,
  resolveProofGenerator,
  resolveVerifierAdapter,
  type SchemaUri,
  UnknownSchemaError,
} from "./schema.ts";

export type {
  Offer,
  Payment,
  RequestResult,
  Spec,
} from "@anchr/protocol/types";

export type {
  ProofGenerator,
  SchemaProducer,
  SchemaProducerContext,
  SchemaVerifier,
  VerifierAdapter,
} from "./schema.ts";

export type {
  ProviderHandler,
  ProviderOffer,
  ProviderRequestEvent,
} from "./provider-types.ts";

export type {
  CustomerOptions,
  CustomerOracle,
  OfferSelector,
  OracleSelector,
  RequestOptions,
} from "./customer-types.ts";

export type { ProviderOptions } from "./provider-types.ts";

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
} from "./adapters/nostr/mod.ts";

export {
  type ActorStateStore,
  createIndexedDbStateStore,
  createMemoryStateStore,
  IndexedDbStateStoreError,
  type IndexedDbStateStoreOptions,
  type MemoryStateStoreOptions,
} from "./adapters/storage.ts";

export {
  createHttpOracleClient,
  type HttpOracleOptions,
  type OracleClient,
  OracleConfigError,
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
} from "./adapters/cashu.ts";

export {
  createQueryService,
  createQueryStore,
  type QueryService,
  type QueryStore,
} from "./requests/application/query-service.ts";
export { MIN_ESCROW_LOCKTIME_SECS } from "./requests/application/query-escrow-validation.ts";
export type {
  Oracle,
  OracleAttestation,
  OracleInfo,
} from "./requests/domain/oracle-types.ts";
export type { Query, QueryResult } from "./requests/domain/types.ts";
export {
  createMockEscrowProvider,
  driveQuorumToProcessing,
  driveToProcessing,
  makeEscrowInfo,
  makeFakeToken,
  makeMockOracle,
  makeQuorumService,
  makeServiceWithPreimage,
} from "./requests/testing/protocol-helpers.ts";
