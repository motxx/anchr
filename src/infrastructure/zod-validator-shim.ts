/**
 * Native Zod v4 + Hono validation middleware.
 *
 * Replaces `@hono/zod-validator` so we can hold a fully-typed boundary
 * (zod's own `ZodType` and `SafeParseReturnType`, no library cross-version
 * casts). Behaviour matches the parts we actually use: parse the named
 * target with the schema, optionally invoke a hook that may short-circuit
 * with a Response, otherwise call `c.req.addValidatedData(target, data)`
 * so handlers can read it via `c.req.valid(target)`.
 */

import type { Context, MiddlewareHandler, TypedResponse } from "hono";
import type { z } from "zod";

type Target = "json" | "form" | "query" | "param" | "header" | "cookie";

type Hook<TSchema extends z.ZodType<object>> = (
  result: z.ZodSafeParseResult<z.infer<TSchema>>,
  c: Context,
) =>
  | Response
  | TypedResponse
  | Promise<Response | TypedResponse | undefined | void>
  | undefined
  | void;

async function readTarget(c: Context, target: Target): Promise<unknown> {
  switch (target) {
    case "json":
      return await c.req.json();
    case "form":
      return await c.req.parseBody();
    case "query":
      return Object.fromEntries(new URL(c.req.url).searchParams.entries());
    case "param":
      return c.req.param();
    case "header":
      return c.req.header();
    case "cookie": {
      const header = c.req.header("cookie") ?? "";
      const out: Record<string, string> = {};
      for (const pair of header.split(/;\s*/).filter(Boolean)) {
        const eq = pair.indexOf("=");
        if (eq < 0) continue;
        const k = decodeURIComponent(pair.slice(0, eq).trim());
        const v = decodeURIComponent(pair.slice(eq + 1).trim());
        if (k) out[k] = v;
      }
      return out;
    }
  }
}

/**
 * Validate a Zod schema for the named target ("json" / "query" / ...) and
 * return a `MiddlewareHandler` that drops into any `app.post()` /
 * `app.get()` chain. The validated value is stored on the request so
 * downstream handlers can read it with `c.req.valid(target)`.
 */
export function validateZ<TSchema extends z.ZodType<object>>(
  target: Target,
  schema: TSchema,
  hook?: Hook<TSchema>,
): MiddlewareHandler {
  return async (c, next) => {
    let raw: unknown;
    try {
      raw = await readTarget(c, target);
    } catch {
      return c.json({ error: `Invalid ${target} body` }, 400);
    }

    const result = schema.safeParse(raw);

    if (hook) {
      const hookOut = await hook(result, c);
      if (hookOut instanceof Response) return hookOut;
    }

    if (!result.success) {
      return c.json({
        error: `Invalid ${target} body`,
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }, 400);
    }

    c.req.addValidatedData(target, result.data);
    await next();
  };
}
