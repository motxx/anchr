/**
 * File system compat layer: Bun.file/write → Deno file APIs
 */

export async function readFile(path: string): Promise<Uint8Array> {
  return await Deno.readFile(path);
}

export async function writeFile(path: string, data: Uint8Array | BufferSource | string): Promise<void> {
  if (typeof data === "string") {
    await Deno.writeTextFile(path, data);
  } else {
    await Deno.writeFile(path, data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer));
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function fileLastModified(path: string): Promise<number> {
  const stat = await Deno.stat(path);
  return stat.mtime?.getTime() ?? 0;
}

export async function readFileAsArrayBuffer(path: string): Promise<ArrayBuffer> {
  const data = await Deno.readFile(path);
  return data.buffer as ArrayBuffer;
}
