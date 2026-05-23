/**
 * File system compat layer: Bun.file/write → Deno file APIs
 */

export async function readFile(path: string): Promise<Uint8Array> {
  return await Deno.readFile(path);
}

export async function writeFile(
  path: string,
  data: Uint8Array | BufferSource | string,
): Promise<void> {
  if (typeof data === "string") {
    await Deno.writeTextFile(path, data);
  } else {
    await Deno.writeFile(path, toUint8Array(data));
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

export async function readFileAsArrayBuffer(
  path: string,
): Promise<ArrayBuffer> {
  const data = await Deno.readFile(path);
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function toUint8Array(data: Uint8Array | BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}
