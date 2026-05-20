import { describe, test, expect, mock } from "bun:test";
import type { NotificationProvider, NotificationContent } from "../notifications";

function createMockNotificationProvider(overrides?: Partial<NotificationProvider>): NotificationProvider {
  return {
    requestPermission: mock(() => Promise.resolve(true)),
    configureForegroundHandler: mock(() => {}),
    scheduleImmediate: mock(() => Promise.resolve()),
    ...overrides,
  };
}

describe("NotificationProvider contract", () => {
  test("requestPermission returns boolean", async () => {
    const provider = createMockNotificationProvider();
    expect(await provider.requestPermission()).toBe(true);
  });

  test("configureForegroundHandler is callable", () => {
    const provider = createMockNotificationProvider();
    expect(() => provider.configureForegroundHandler()).not.toThrow();
  });

  test("scheduleImmediate sends notification", async () => {
    const scheduleFn = mock(() => Promise.resolve());
    const provider = createMockNotificationProvider({ scheduleImmediate: scheduleFn });

    const content: NotificationContent = {
      title: "📍 Near you",
      subtitle: "Shibuya",
      body: "渋谷スクランブル交差点の撮影 — 21 sats",
      data: { queryId: "q1" },
    };

    await provider.scheduleImmediate(content);
    expect(scheduleFn).toHaveBeenCalledWith(content);
  });

  test("denied permission returns false", async () => {
    const provider = createMockNotificationProvider({
      requestPermission: mock(() => Promise.resolve(false)),
    });
    expect(await provider.requestPermission()).toBe(false);
  });
});

export { createMockNotificationProvider };
