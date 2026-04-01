/**
 * Environment compat layer: import.meta.dir → dirname from import.meta.url
 */

import { dirname } from "node:path";

export function moduleDir(meta: ImportMeta): string {
  return dirname(new URL(meta.url).pathname);
}
