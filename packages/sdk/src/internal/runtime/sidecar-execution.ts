import { spawn, type SpawnOptions, type SpawnResult } from "./process.ts";
import { isFile, which } from "./which.ts";

export interface SidecarExecutor {
  spawn(cmd: string[], opts?: SpawnOptions): SpawnResult;
  which(name: string): string | null;
  isFile(path: string): boolean;
}

export const serverSidecarExecutor: SidecarExecutor = {
  spawn,
  which,
  isFile,
};

export type { SpawnOptions, SpawnResult };
