import type { Event as NostrEvent } from "@anchr/protocol/nostr";

export type RuntimeTarget = "browser" | "deno" | "node" | "worker";

export type AdapterCapability =
  | "transport"
  | "payment"
  | "proof_producer"
  | "proof_verifier"
  | "attachment"
  | "local_state"
  | "signer";

export interface AdapterManifest {
  id: string;
  technology: string;
  capabilities: readonly AdapterCapability[];
  runtimes: readonly RuntimeTarget[];
  experimental: boolean;
}

export interface CapabilityAdapter {
  readonly manifest?: AdapterManifest;
}

export interface CapabilityCheckResult {
  ok: boolean;
  missing: readonly AdapterCapability[];
}

export function missingCapabilities(
  manifest: AdapterManifest,
  required: readonly AdapterCapability[],
): AdapterCapability[] {
  return required.filter((capability) =>
    !manifest.capabilities.includes(capability)
  );
}

export function checkCapabilities(
  manifest: AdapterManifest,
  required: readonly AdapterCapability[],
): CapabilityCheckResult {
  const missing = missingCapabilities(manifest, required);
  return { ok: missing.length === 0, missing };
}

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
}

export interface CashuClient {
  readonly manifest?: AdapterManifest;
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
  readonly manifest?: AdapterManifest;
  publish(event: NostrEvent): Promise<PublishResult>;
  subscribe(
    filter: Filter,
    onEvent: (event: NostrEvent) => void,
    onEose?: () => void,
  ): Subscription;
  close(): void;
}

export interface ActorStateStore {
  readonly manifest?: AdapterManifest;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
