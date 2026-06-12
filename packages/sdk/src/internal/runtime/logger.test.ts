import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import type { LogRecord } from "@logtape/logtape";
import { withEnv } from "../../testing/helpers.ts";
import { configureAnchrLogging, getLogger } from "./logger.ts";

function recordingSink(): {
  records: LogRecord[];
  sink: (r: LogRecord) => void;
} {
  const records: LogRecord[] = [];
  return { records, sink: (record) => records.push(record) };
}

describe("ANCHR_LOG_LEVEL-driven logging", () => {
  test("ANCHR_LOG_LEVEL=debug emits debug output", () => {
    withEnv({ ANCHR_LOG_LEVEL: "debug", LOG_LEVEL: undefined }, () => {
      const { records, sink } = recordingSink();
      configureAnchrLogging({ sink, reset: true });

      getLogger(["anchr", "logger-test"]).debug("visible at debug");

      expect(records.length).toBe(1);
      expect(records[0]!.level).toBe("debug");
    });
  });

  test("default level (info) filters debug but emits info and error", () => {
    withEnv({ ANCHR_LOG_LEVEL: undefined, LOG_LEVEL: undefined }, () => {
      const { records, sink } = recordingSink();
      configureAnchrLogging({ sink, reset: true });

      const log = getLogger(["anchr", "logger-test"]);
      log.debug("hidden");
      log.info("shown");
      log.error("also shown");

      expect(records.map((r) => r.level)).toEqual(["info", "error"]);
    });
  });

  test("LOG_LEVEL fallback applies when ANCHR_LOG_LEVEL is unset", () => {
    withEnv({ ANCHR_LOG_LEVEL: undefined, LOG_LEVEL: "error" }, () => {
      const { records, sink } = recordingSink();
      configureAnchrLogging({ sink, reset: true });

      const log = getLogger(["anchr", "logger-test"]);
      log.info("hidden");
      log.warn("hidden too");
      log.error("shown");

      expect(records.map((r) => r.level)).toEqual(["error"]);
    });
  });
});
