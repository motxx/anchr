/**
 * Anchr SDK — buy cryptographically verified data with sats.
 *
 * Public surface composes the Customer / Provider / Oracle API with the
 * supporting Nostr / Cashu / proof helpers. Each domain lives in its own
 * sibling file; this barrel is intentionally a re-export only.
 */

export {
  createCustomer,
  type Customer,
  CustomerConfigError,
  DEFAULT_LOCKTIME_SECONDS,
  DEFAULT_OFFER_WINDOW_MS,
  DEFAULT_RESULT_TIMEOUT_MS,
  NoOffersReceivedError,
  pickOracleForRequest,
  RelayPublishError,
  ResultTimeoutError,
  SchemaVerificationError,
  selectCheapestOffer,
  validateCustomerOptions,
} from "./customer.ts";

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
  getRegisteredSchemaBundles,
  getSchemaBundle,
  InvalidSchemaUriError,
  isSchemaUri,
  ProofSchema,
  registerSchemaBundle,
  resolveProofGenerator,
  resolveSchemaEvidence,
  resolveVerifierAdapter,
  type SchemaUri,
  UnknownSchemaError,
  unregisterSchemaBundle,
} from "./schema.ts";

export type { Offer, Payment, Spec } from "@anchr/protocol/types";

export type {
  ProofGenerator,
  SchemaBundle,
  SchemaConfigParser,
  SchemaEvidencePayload,
  SchemaEvidenceResolver,
  SchemaOptions,
  SchemaOptionsMap,
  SchemaProducer,
  SchemaProducerContext,
  SchemaVerifier,
  SchemaVerifierContext,
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
  RequestResult,
} from "./customer-types.ts";

export type { ProviderOptions } from "./provider-types.ts";

export type {
  AttachmentRef,
  AttachmentStorageKind,
  BlossomKeyMap,
  BlossomKeyMaterial,
  VerificationFactor,
} from "./values.ts";
export { VERIFICATION_FACTORS } from "./values.ts";

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
  createNostrOracleClient,
  type NostrOracleOptions,
  type OracleClient,
  OracleConfigError,
  OracleResponseError,
  OracleTimeoutError,
} from "./oracle.ts";
export type { Clock, IdGenerator } from "./requests/domain/ports.ts";
export {
  type HashResponderOptions,
  serveHashRequests,
} from "./adapters/nostr/hash-responder.ts";

export {
  type BindProviderParams,
  type BuildHtlcLockParams,
  type CashuClient,
  CashuClientError,
  type CashuClientOptions,
  CashuMintError,
  CashuMintUncertainError,
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
