/** Runtime family an adapter is expected to work in. */
export type RuntimeTarget = "browser" | "deno" | "node" | "worker";

/** Technology-neutral capability categories used by actor SDK ports. */
export type AdapterCapability =
  | "transport"
  | "payment"
  | "proof_producer"
  | "proof_verifier"
  | "attachment"
  | "local_state"
  | "signer";

/** Metadata every concrete adapter can expose for conformance checks. */
export interface AdapterManifest {
  /** Stable adapter id, e.g. `nostr-relay` or `cashu-htlc`. */
  id: string;
  /** Concrete technology bound by the adapter. */
  technology: string;
  /** Capabilities this adapter satisfies. */
  capabilities: readonly AdapterCapability[];
  /** Runtimes the adapter is designed to support. */
  runtimes: readonly RuntimeTarget[];
  /** True when the technology is replaceable reference infrastructure. */
  experimental: boolean;
}

/** Structural base for adapter/plugin implementations. */
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
