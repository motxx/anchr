/** GPS factor: submission-body coordinates against the expected location. */

import { haversineKm } from "../../geo.ts";
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
  if (input.gps && requirement.expected_gps) {
    const dist = haversineKm(
      input.gps.lat,
      input.gps.lon,
      requirement.expected_gps.lat,
      requirement.expected_gps.lon,
    );
    if (dist <= maxGpsDist) {
      acc.checks.push(
        `body GPS within ${maxGpsDist}km of expected (${dist.toFixed(1)}km)`,
      );
    } else {
      acc.failures.push(
        `body GPS ${
          dist.toFixed(1)
        }km from expected location (max ${maxGpsDist}km)`,
      );
    }
  } else if (
    !input.gps && requirement.expected_gps &&
    requirement.factors.includes("gps")
  ) {
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
    const dist = haversineKm(
      gps.lat,
      gps.lon,
      expectedGps.lat,
      expectedGps.lon,
    );
    if (dist <= maxGpsDist) {
      checks.push(
        `${label} GPS within ${maxGpsDist}km of expected (${
          dist.toFixed(1)
        }km)`,
      );
    } else {
      failures.push(
        `${label} GPS ${
          dist.toFixed(1)
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
