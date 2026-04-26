/**
 * Process spawning compat layer: Bun.spawn → Deno.Command
 *
 * Wraps Deno.Command to match the Bun.spawn interface.
 */

export interface SpawnOptions {
  stdout?: "pipe" | "inherit" | "ignore";
  stderr?: "pipe" | "inherit" | "ignore";
  stdin?: "pipe" | "inherit" | "ignore";
  cwd?: string;
  env?: Record<string, string>;
}

export interface SpawnResult {
  exited: Promise<void>;
  exitCode: number | null;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  kill(): void;
}

function mapStdio(value?: string): "piped" | "inherit" | "null" {
  if (value === "pipe") return "piped";
  if (value === "ignore") return "null";
  return "inherit";
}

/**
 * Collect a piped stream into a single Uint8Array eagerly.
 * This avoids Deno resource leaks from unconsumed streams.
 * Returns a new ReadableStream that replays the collected data.
 */
function collectStream(stream: ReadableStream<Uint8Array> | null): ReadableStream<Uint8Array> {
  if (!stream) return new ReadableStream({ start(c) { c.close(); } });

  // Eagerly consume the original stream into a buffer
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  const done = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } catch { /* stream error, ignore */ }
  })();

  // Return a new stream that replays collected data
  return new ReadableStream({
    async start(controller) {
      await done;
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

export function spawn(cmd: string[], opts?: SpawnOptions): SpawnResult {
  const [command, ...args] = cmd;
  const child = new Deno.Command(command!, {
    args,
    stdout: mapStdio(opts?.stdout),
    stderr: mapStdio(opts?.stderr),
    stdin: mapStdio(opts?.stdin),
    cwd: opts?.cwd,
    env: opts?.env,
  }).spawn();

  let _exitCode: number | null = null;
  const exited = child.status.then((s) => {
    _exitCode = s.code;
  });

  // Eagerly collect piped streams to prevent resource leaks
  const stdout = collectStream(child.stdout);
  const stderr = collectStream(child.stderr);

  return {
    exited,
    get exitCode() { return _exitCode; },
    stdout,
    stderr,
    kill() { try { child.kill(); } catch { /* already dead */ } },
  };
}
