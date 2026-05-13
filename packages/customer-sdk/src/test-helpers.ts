/**
 * Test-only helpers shared across the SDK's `*.test.ts` files.
 *
 * NOT included in the published JSR package (excluded via deno.json's
 * publish.exclude) — keep imports here limited to test usage.
 */

/** Encode a Uint8Array as lowercase hex (no `0x` prefix). */
export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}
