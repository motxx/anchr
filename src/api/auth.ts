import type { Context } from "hono";
import { getRuntimeConfig } from "../config";

export function getHttpApiKey(c: Context): string | null {
  const authorization = c.req.header("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token || null;
  }

  const apiKey = c.req.header("x-api-key")?.trim();
  return apiKey || null;
}

export function requireWriteApiKey(c: Context): Response | null {
  const { httpApiKeys } = getRuntimeConfig();
  if (httpApiKeys.length === 0) {
    return null;
  }

  const supplied = getHttpApiKey(c);
  if (supplied && httpApiKeys.includes(supplied)) {
    return null;
  }

  return c.json(
    {
      error: "Unauthorized",
      hint: "Set Authorization: Bearer <key> or X-API-Key: <key> to access write endpoints.",
    },
    401,
    {
      "www-authenticate": "Bearer",
    },
  );
}
