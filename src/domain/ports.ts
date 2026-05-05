/**
 * Domain ports for the side effects the business logic *must* be allowed
 * to depend on but cannot legitimately call directly: time, randomness,
 * identifier generation. Tests inject deterministic implementations; the
 * production path uses the platform-backed defaults.
 *
 * Keeping these as explicit interfaces — rather than `Date.now()` and
 * `crypto.getRandomValues()` calls scattered through the aggregate — is
 * the only way to keep the domain layer pure enough to reason about
 * (and to lint with arch-lint E007).
 */

export interface Clock {
  /** Current wall-clock time, milliseconds since the Unix epoch. */
  now(): number;
}

export interface IdGenerator {
  /** Stable, collision-resistant identifier for a new aggregate. */
  newQueryId(): string;
}

export interface NonceGenerator {
  /** Short, human-typeable challenge string for the nonce factor. */
  newChallengeNonce(): string;
}

export interface DomainServices {
  clock: Clock;
  idGenerator: IdGenerator;
  nonceGenerator?: NonceGenerator;
}

/** Wall-clock implementation backed by `Date.now()`. */
export const realClock: Clock = {
  now: () => Date.now(),
};

/**
 * Default ID generator. Uses Web Crypto for entropy and the real clock for
 * the timestamp segment. The format `query_<unix-ms>_<16 hex chars>` is
 * an opaque string from a downstream caller's perspective; the prefix is
 * a debugging convenience for log scanning, not a stable contract.
 */
export function createDefaultIdGenerator(clock: Clock = realClock): IdGenerator {
  return {
    newQueryId(): string {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `query_${clock.now()}_${hex}`;
    },
  };
}

export const realIdGenerator: IdGenerator = createDefaultIdGenerator();

/** Convenience bundle for callers that want every default at once. */
export const realDomainServices: DomainServices = {
  clock: realClock,
  idGenerator: realIdGenerator,
};
