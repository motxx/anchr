import { describe, test, expect, mock } from "bun:test";
import type { ClipboardProvider } from "../clipboard";

function createMockClipboardProvider(overrides?: Partial<ClipboardProvider>): ClipboardProvider {
  return {
    copyText: mock(() => Promise.resolve()),
    ...overrides,
  };
}

describe("ClipboardProvider contract", () => {
  test("copyText resolves", async () => {
    const provider = createMockClipboardProvider();
    await expect(provider.copyText("cashuBo2F...")).resolves.toBeUndefined();
  });

  test("copyText is called with the token", async () => {
    const copyFn = mock(() => Promise.resolve());
    const provider = createMockClipboardProvider({ copyText: copyFn });
    await provider.copyText("cashuBo2F_token_here");
    expect(copyFn).toHaveBeenCalledWith("cashuBo2F_token_here");
  });
});

export { createMockClipboardProvider };
