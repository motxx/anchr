import { expect } from "@std/expect";
import {
  checkPackageFile,
  isAllowedRequestFeatureImport,
  isAllowedSdkRequestImport,
  resolveRelativeImportTarget,
} from "./arch-lint.ts";

Deno.test("resolveRelativeImportTarget resolves package-local imports", () => {
  expect(
    resolveRelativeImportTarget(
      "../requests/domain/types.ts",
      "packages/sdk/src/attachments/upload.ts",
    ),
  ).toBe("packages/sdk/src/requests/domain/types.ts");

  expect(
    resolveRelativeImportTarget(
      "../../../requests/application/ports.ts",
      "packages/sdk/src/adapters/nostr/events/events.ts",
    ),
  ).toBe("packages/sdk/src/requests/application/ports.ts");
});

Deno.test("SDK feature folders may import documented request lifecycle shapes", () => {
  expect(
    isAllowedSdkRequestImport(
      "packages/sdk/src/attachments/upload.ts",
      "packages/sdk/src/requests/domain/types.ts",
    ),
  ).toBe(true);

  expect(
    isAllowedSdkRequestImport(
      "packages/sdk/src/payments/cashu-escrow-provider.ts",
      "packages/sdk/src/requests/application/ports.ts",
    ),
  ).toBe(true);

  expect(
    isAllowedSdkRequestImport(
      "packages/sdk/src/adapters/nostr/customer-service.ts",
      "packages/sdk/src/requests/application/ports.ts",
    ),
  ).toBe(true);
});

Deno.test("SDK feature folders may not import arbitrary request internals", () => {
  expect(
    isAllowedSdkRequestImport(
      "packages/sdk/src/attachments/upload.ts",
      "packages/sdk/src/requests/application/query-service.ts",
    ),
  ).toBe(false);

  const violations = checkPackageFile(
    "sdk",
    "packages/sdk/src/attachments/upload.ts",
    `import { createQueryService } from "../requests/application/query-service.ts";`,
  );

  expect(violations.map((v) => v.code)).toContain("E026");
});

Deno.test("E029 flags re-exporting a requests/ lifecycle type to a public surface", () => {
  const violations = checkPackageFile(
    "sdk",
    "packages/sdk/src/index.ts",
    `export type { Query } from "./requests/domain/types.ts";`,
  );
  expect(violations.map((v) => v.code)).toContain("E029");
});

Deno.test("E029 allows re-exporting documented request ports and the Oracle contract", () => {
  const ports = checkPackageFile(
    "sdk",
    "packages/sdk/src/index.ts",
    `export type { Clock, IdGenerator } from "./requests/domain/ports.ts";`,
  );
  expect(ports.map((v) => v.code)).not.toContain("E029");

  const oracleContract = checkPackageFile(
    "sdk",
    "packages/sdk/src/adapters/oracle-client/index.ts",
    `export type {\n  Oracle,\n  OracleVerificationDetail,\n} from "../../requests/domain/oracle-types.ts";`,
  );
  expect(oracleContract.map((v) => v.code)).not.toContain("E029");
});

Deno.test("E029 does not apply inside requests/ or testing/", () => {
  const testing = checkPackageFile(
    "sdk",
    "packages/sdk/src/testing/mod.ts",
    `export { QueryService } from "../requests/application/query-service.ts";`,
  );
  expect(testing.map((v) => v.code)).not.toContain("E029");
});

Deno.test("request internals may consume only documented feature ports", () => {
  expect(
    isAllowedRequestFeatureImport(
      "packages/sdk/src/requests/application/query-service.ts",
      "packages/sdk/src/payments/mod.ts",
    ),
  ).toBe(false);

  expect(
    isAllowedRequestFeatureImport(
      "packages/sdk/src/requests/domain/types.ts",
      "packages/sdk/src/proofs/mod.ts",
    ),
  ).toBe(true);

  expect(
    isAllowedRequestFeatureImport(
      "packages/sdk/src/requests/application/query-service.ts",
      "packages/sdk/src/adapters/nostr/customer-service.ts",
    ),
  ).toBe(false);
});
