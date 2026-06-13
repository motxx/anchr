/**
 * Runtime compat layer — barrel export.
 * Thin wrappers mapping Bun APIs to Deno equivalents.
 */

export { spawn, type SpawnOptions, type SpawnResult } from "./process.ts";
export {
  serverSidecarExecutor,
  type SidecarExecutor,
} from "./sidecar-execution.ts";
export {
  fileExists,
  fileLastModified,
  readFile,
  readFileAsArrayBuffer,
  readTextFile,
  replaceTextFileAtomically,
  RuntimeFileNotFoundError,
  writeFile,
  writeTextFile,
} from "./fs.ts";
export { isFile, which } from "./which.ts";
export { moduleDir } from "./env.ts";
export {
  detectRuntimeTarget,
  isBrowserRuntime,
  isDenoRuntime,
  isNodeRuntime,
  isWorkerRuntime,
  type RuntimeTarget,
} from "./runtime.ts";
