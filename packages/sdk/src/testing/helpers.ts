/** Execute `fn` with temporary env overrides, then restore. */
export function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => void | Promise<void>,
): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = Deno.env.get(key);
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  };
  const result = fn();
  if (result instanceof Promise) return result.finally(restore);
  restore();
}
