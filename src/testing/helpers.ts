/**
 * Shared test helpers for environment variable overrides.
 *
 * Two variants:
 * - `withEnv(overrides, fn)` — executes fn immediately, restores env after
 * - `withEnvThunk(overrides, fn)` — returns an async wrapper for use as test callback
 */

/** Execute `fn` with temporary env overrides, then restore. Handles sync and async fns. */
export function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  const result = fn();
  if (result instanceof Promise) return result.finally(restore);
  restore();
}

/** Return an async wrapper that applies env overrides around `fn`. Use as a test callback. */
export function withEnvThunk(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): () => Promise<void> {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
      saved[key] = process.env[key];
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    try {
      await fn();
    } finally {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
}
