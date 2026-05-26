Deno.test("README TypeScript snippets type-check", async () => {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "check",
      "--doc-only",
      "README.md",
      "packages/sdk/README.md",
    ],
    cwd: Deno.cwd(),
  });

  const output = await command.output();
  if (!output.success) {
    const decoder = new TextDecoder();
    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    throw new Error(`${stdout}${stderr}`);
  }
});
