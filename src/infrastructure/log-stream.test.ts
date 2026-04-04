import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { emitLog, subscribeLog, getRecentLogs, type LogEntry } from "./log-stream";

describe("log-stream", () => {
  test("emitLog delivers to subscribers", () => {
    const received: LogEntry[] = [];
    const unsub = subscribeLog((entry) => received.push(entry));

    emitLog("test-svc", "hello world");

    expect(received.length).toBe(1);
    expect(received[0].service).toBe("test-svc");
    expect(received[0].message).toBe("hello world");
    expect(typeof received[0].ts).toBe("number");

    unsub();
  });

  test("unsubscribe stops delivery", () => {
    const received: LogEntry[] = [];
    const unsub = subscribeLog((entry) => received.push(entry));

    emitLog("svc", "before");
    unsub();
    emitLog("svc", "after");

    expect(received.length).toBe(1);
    expect(received[0].message).toBe("before");
  });

  test("getRecentLogs returns buffered entries", () => {
    // Emit some logs (these accumulate in the global buffer)
    emitLog("test", "log-a");
    emitLog("test", "log-b");

    const recent = getRecentLogs(50);
    expect(recent.length).toBeGreaterThanOrEqual(2);
    const messages = recent.map((e) => e.message);
    expect(messages).toContain("log-a");
    expect(messages).toContain("log-b");
  });

  test("getRecentLogs respects count limit", () => {
    for (let i = 0; i < 10; i++) {
      emitLog("bulk", `msg-${i}`);
    }

    const limited = getRecentLogs(3);
    expect(limited.length).toBe(3);
  });

  test("multiple subscribers receive same event", () => {
    const r1: LogEntry[] = [];
    const r2: LogEntry[] = [];
    const u1 = subscribeLog((e) => r1.push(e));
    const u2 = subscribeLog((e) => r2.push(e));

    emitLog("multi", "shared");

    expect(r1.length).toBe(1);
    expect(r2.length).toBe(1);
    expect(r1[0].message).toBe("shared");

    u1();
    u2();
  });

  test("subscriber error does not break other subscribers", () => {
    const received: LogEntry[] = [];
    const u1 = subscribeLog(() => { throw new Error("oops"); });
    const u2 = subscribeLog((e) => received.push(e));

    emitLog("err-test", "still works");

    expect(received.length).toBe(1);
    expect(received[0].message).toBe("still works");

    u1();
    u2();
  });
});
