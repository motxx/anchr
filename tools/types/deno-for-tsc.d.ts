declare namespace Deno {
  export const version: {
    deno?: string;
  };

  export const env: {
    get(name: string): string | undefined;
    set(name: string, value: string): void;
    delete(name: string): void;
  };

  export namespace errors {
    export class NotFound extends Error {}
  }

  export interface FileInfo {
    isFile: boolean;
    mtime: Date | null;
  }

  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(
    path: string,
    data: Uint8Array,
  ): Promise<void>;
  export function readTextFileSync(path: string): string;
  export function writeTextFile(path: string, data: string): Promise<void>;
  export function writeTextFileSync(path: string, data: string): void;
  export function renameSync(oldpath: string, newpath: string): void;
  export function stat(path: string): Promise<FileInfo>;
  export function statSync(path: string): FileInfo;

  export type CommandStdio = "inherit" | "piped" | "null";

  export interface CommandOptions {
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: CommandStdio;
    stdout?: CommandStdio;
    stderr?: CommandStdio;
  }

  export interface CommandStatus {
    code: number;
  }

  export interface CommandOutput extends CommandStatus {
    readonly stdout: Uint8Array;
    readonly stderr: Uint8Array;
  }

  export interface ChildProcess {
    readonly status: Promise<CommandStatus>;
    readonly stdout: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    kill(): void;
  }

  export class Command {
    constructor(command: string, options?: CommandOptions);
    outputSync(): CommandOutput;
    spawn(): ChildProcess;
  }
}

declare const Deno: typeof Deno;
