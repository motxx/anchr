export type RuntimeTarget = "browser" | "deno" | "node" | "worker";

export function detectRuntimeTarget(): RuntimeTarget {
  if (typeof Deno !== "undefined" && Deno.version?.deno !== undefined) {
    return "deno";
  }
  const processValue: unknown = Reflect.get(globalThis, "process");
  if (isNodeProcess(processValue)) {
    return "node";
  }
  const importScriptsValue: unknown = Reflect.get(globalThis, "importScripts");
  if (typeof importScriptsValue === "function") {
    return "worker";
  }
  return "browser";
}

export function isBrowserRuntime(): boolean {
  return detectRuntimeTarget() === "browser";
}

export function isDenoRuntime(): boolean {
  return detectRuntimeTarget() === "deno";
}

export function isNodeRuntime(): boolean {
  return detectRuntimeTarget() === "node";
}

export function isWorkerRuntime(): boolean {
  return detectRuntimeTarget() === "worker";
}

function isNodeProcess(
  value: unknown,
): value is { versions: { node: string } } {
  if (typeof value !== "object" || value === null) return false;
  if (!("versions" in value)) return false;
  const versions = value.versions;
  if (typeof versions !== "object" || versions === null) return false;
  if (!("node" in versions)) return false;
  return typeof versions.node === "string";
}
