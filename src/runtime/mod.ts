/**
 * Runtime compat layer — barrel export.
 * Thin wrappers mapping Bun APIs to Deno equivalents.
 */

export { spawn, type SpawnOptions, type SpawnResult } from "./process.ts";
export { readFile, writeFile, fileExists, fileLastModified, readFileAsArrayBuffer } from "./fs.ts";
export { which } from "./which.ts";
export { moduleDir } from "./env.ts";
