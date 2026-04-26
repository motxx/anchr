/**
 * which() compat layer: Bun.which → Deno.Command("which")
 */

export function which(name: string): string | null {
  try {
    const cmd = new Deno.Command("which", { args: [name], stdout: "piped", stderr: "null" });
    const result = cmd.outputSync();
    if (result.code !== 0) return null;
    return new TextDecoder().decode(result.stdout).trim() || null;
  } catch {
    return null;
  }
}
