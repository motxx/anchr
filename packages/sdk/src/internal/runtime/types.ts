/**
 * Runtime-narrowing predicates for parsing untyped boundaries (JSON, fetch
 * responses, IPC payloads). Each predicate is a `x is T` type guard so call
 * sites narrow without needing `as` casts.
 *
 *   const json: unknown = await response.json();
 *   if (!isRecord(json)) throw new Error("expected object");
 *   const passed = json.passed;            // typed: unknown
 *   if (!isBoolean(passed)) throw ...;     // narrows to boolean
 */

export function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

export function isString(x: unknown): x is string {
  return typeof x === "string";
}

export function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

export function isBoolean(x: unknown): x is boolean {
  return typeof x === "boolean";
}

export function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every(isString);
}

export function isRecordArray(x: unknown): x is Record<string, unknown>[] {
  return Array.isArray(x) && x.every(isRecord);
}

/** Read a string field; throws if missing or wrong type. */
export function requireString(
  obj: Record<string, unknown>,
  key: string,
): string {
  const v = obj[key];
  if (!isString(v)) throw new TypeError(`expected ${key} to be a string`);
  return v;
}

/** Read a string field if present, otherwise undefined. Throws if present-but-wrong-type. */
export function optionalString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (!isString(v)) throw new TypeError(`expected ${key} to be a string`);
  return v;
}

/** Read a boolean field; throws if missing or wrong type. */
export function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
): boolean {
  const v = obj[key];
  if (!isBoolean(v)) throw new TypeError(`expected ${key} to be a boolean`);
  return v;
}

/** Read a number field; throws if missing or non-finite. */
export function requireNumber(
  obj: Record<string, unknown>,
  key: string,
): number {
  const v = obj[key];
  if (!isNumber(v)) {
    throw new TypeError(`expected ${key} to be a finite number`);
  }
  return v;
}

/** Read a number field if present, otherwise undefined. Throws if present-but-non-finite. */
export function optionalNumber(
  obj: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (!isNumber(v)) {
    throw new TypeError(`expected ${key} to be a finite number`);
  }
  return v;
}

/** Read a string-array field; throws if not array-of-strings. */
export function requireStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] {
  const v = obj[key];
  if (!isStringArray(v)) {
    throw new TypeError(`expected ${key} to be an array of strings`);
  }
  return v;
}

/** Read a string-array field if present; defaults to []. Throws if present-but-wrong-type. */
export function optionalStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] {
  const v = obj[key];
  if (v === undefined || v === null) return [];
  if (!isStringArray(v)) {
    throw new TypeError(`expected ${key} to be an array of strings`);
  }
  return v;
}
