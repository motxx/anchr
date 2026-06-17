import type { Event as NostrEvent } from "@anchr/protocol/nostr";

export type CashuProof = unknown;

export interface BuildHtlcLockParams {
  amountSats: number;
  hashHex: string;
  customerPubkey: string;
  locktimeSeconds: number;
  sourceProofs: CashuProof[];
}

export interface BindProviderParams {
  initialProofs: CashuProof[];
  providerPubkey: string;
  hashHex: string;
  locktimeSeconds: number;
  customerPubkey: string;
  customerSecretKey: Uint8Array;
}

export interface RedeemHtlcParams {
  token: string;
  preimageHex: string;
  providerSecretKey: Uint8Array;
}

export interface RedeemResult {
  proofs: CashuProof[];
  amountSats: number;
}

export interface CashuToken {
  token: string;
  amountSats: number;
  proofs: CashuProof[];
  changeProofs?: CashuProof[];
}

export interface CashuClient {
  buildHtlcLock(params: BuildHtlcLockParams): Promise<CashuToken>;
  bindProvider(params: BindProviderParams): Promise<CashuToken>;
  redeemHtlc(params: RedeemHtlcParams): Promise<RedeemResult>;
  readonly mintUrl: string;
}

export interface PublishResult {
  successes: string[];
  failures: { relay: string; reason: string }[];
}

export interface Filter {
  kinds?: number[];
  authors?: string[];
  ids?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [tagFilter: `#${string}`]: string[] | undefined;
}

export interface Subscription {
  close(): void;
}

export interface RelayClient {
  publish(event: NostrEvent): Promise<PublishResult>;
  subscribe(
    filter: Filter,
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void,
  ): Subscription;
  close(): void;
}

export interface ActorStateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PersistenceStore {
  readText(key: string): Promise<string>;
  writeText(key: string, value: string): Promise<void>;
  replaceTextAtomically(key: string, value: string): Promise<void>;
}
