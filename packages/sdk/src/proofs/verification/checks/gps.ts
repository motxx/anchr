/** GPS factor: submission-body coordinates against the expected location. */

import { evaluateGpsDistancePolicy } from "../../geo.ts";
import type { GpsCoord } from "../../../values.ts";
import type {
  VerificationInput,
  VerificationRequirement,
} from "../contract.ts";
import type { CheckAccumulator, FactorCheck } from "./types.ts";

function verifyBodyGps(
  requirement: VerificationRequirement,
  input: VerificationInput,
  maxGpsDist: number,
  acc: CheckAccumulator,
): void {
  if (input.gps) {
    checkGpsProximity(
      input.gps,
      requirement.expected_gps,
      maxGpsDist,
      "body",
      acc.checks,
      acc.failures,
    );
  } else if (requirement.factors.includes("gps")) {
    // The gps factor demands evidence even when the requirement carries no
    // expected location — fail closed instead of passing an empty submission.
    acc.failures.push(
      "GPS coordinates missing from submission body — required by verification policy",
    );
  }
}

export function checkGpsProximity(
  gps: GpsCoord | undefined,
  expectedGps: GpsCoord | undefined,
  maxGpsDist: number,
  label: string,
  checks: string[],
  failures: string[],
): void {
  if (gps && expectedGps) {
    const policy = evaluateGpsDistancePolicy(gps, expectedGps, maxGpsDist);
    if (policy.withinLimit) {
      checks.push(
        `${label} GPS within ${maxGpsDist}km of expected (${
          policy.distanceKm.toFixed(1)
        }km)`,
      );
    } else {
      failures.push(
        `${label} GPS ${
          policy.distanceKm.toFixed(1)
        }km from expected location (max ${maxGpsDist}km)`,
      );
    }
  } else if (gps) {
    checks.push(`${label} GPS: ${gps.lat.toFixed(4)}, ${gps.lon.toFixed(4)}`);
  }
}

export const bodyGpsCheck: FactorCheck = {
  name: "body-gps",
  run(ctx) {
    verifyBodyGps(ctx.requirement, ctx.input, ctx.maxGpsDistanceKm, ctx.acc);
  },
};
