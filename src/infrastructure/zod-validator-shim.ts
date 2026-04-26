/**
 * Typed shim for @hono/zod-validator + Zod v4.
 *
 * The library types its `schema` parameter against Zod v3's `ZodSchema`. Zod
 * v4's `ZodType` is structurally compatible at runtime but not assignable to
 * the v3 type, and the returned middleware's specific generics
 * (`MiddlewareHandler<Env, string, DefaultInput<...>, ...>`) don't unify with
 * consumer routes' inferred generics.
 *
 * This shim isolates the library boundary: a single `unknown` step bridges
 * the type surfaces, and the `any`-relaxed `MiddlewareHandler<any, any, any>`
 * return is what consumers want anyway. Runtime behaviour is unchanged.
 */

import { zValidator as zValidatorRaw } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import type { z } from "zod";

type Hook = Parameters<typeof zValidatorRaw>[2];

/**
 * Validate a Zod schema for the named target ("json" / "query" / "form" / etc.)
 * and return a `MiddlewareHandler` that drops into any `app.post()` /
 * `app.get()` chain.
 */
export function validateZ<T extends z.ZodType>(
  target: "json" | "form" | "query" | "param" | "header" | "cookie",
  schema: T,
  hook?: Hook,
  // deno-lint-ignore no-explicit-any -- broad MiddlewareHandler<Env, Path, Input>
): MiddlewareHandler<any, any, any> {
  // deno-lint-ignore no-explicit-any -- Zod v4 ZodType is not assignable to
  // @hono/zod-validator's ZodSchema (Zod v3 type).
  const middleware: unknown = zValidatorRaw(target, schema as any, hook);
  // deno-lint-ignore no-explicit-any -- broad MiddlewareHandler<any, any, any>
  return middleware as MiddlewareHandler<any, any, any>;
}
