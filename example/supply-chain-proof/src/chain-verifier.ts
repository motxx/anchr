/**
 * Supply Chain Proof — Chain Verifier
 *
 * Verifies a complete supply chain by checking:
 *   1. Each step's proofs (GPS within range, TLSNotary responses valid, C2PA intact)
 *   2. Chain integrity (each step references the previous)
 *   3. Time ordering (steps are chronological)
 *   4. Requirement compliance (required proofs present and conditions met)
 *
 * Outputs a ChainVerificationReport with a trust score 0-100.
 *
 * Anchr modules referenced:
 *   - haversineKm()      (src/domain/geo.ts)
 *   - GpsCoord           (src/domain/types.ts)
 *   - TlsnVerifiedData   (src/domain/types.ts)
 */

import type {
  ChainVerificationReport,
  ConditionOperator,
  ProofCheckResult,
  RequiredProof,
  StepProof,
  StepRequirement,
  StepVerdict,
  StepVerificationResult,
  SupplyChainProduct,
  SupplyChainStep,
} from "./supply-chain-types.ts";

// ---------------------------------------------------------------------------
// Haversine (same formula as src/domain/geo.ts — duplicated here so the
// example is self-contained without importing from the Anchr core)
// ---------------------------------------------------------------------------

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

function evaluateCondition(
  actual: unknown,
  operator: ConditionOperator,
  expected: string | number,
): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "gt":
      return typeof actual === "number" && actual > Number(expected);
    case "lt":
      return typeof actual === "number" && actual < Number(expected);
    case "within_km": {
      // `actual` should be { lat, lon } and `expected` is the max distance in km.
      // The reference location comes from the step's location field, passed via data.
      // For within_km, data must contain { lat, lon, ref_lat, ref_lon } or the step
      // location is used as reference. We check data.distance_km if pre-computed,
      // otherwise fall back.
      if (typeof actual === "number") {
        return actual <= Number(expected);
      }
      return false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Individual proof checks
// ---------------------------------------------------------------------------

function checkGpsPhotoProof(
  proof: StepProof,
  step: SupplyChainStep,
  requirement: RequiredProof | undefined,
): ProofCheckResult {
  const data = proof.data as Record<string, unknown>;
  const lat = data.lat as number | undefined;
  const lon = data.lon as number | undefined;

  if (lat === undefined || lon === undefined) {
    return {
      proof_type: "gps_photo",
      passed: false,
      details: "GPS coordinates missing from photo proof",
    };
  }

  const distanceKm = haversineKm(lat, lon, step.location.lat, step.location.lon);

  // Check requirement conditions
  if (requirement) {
    for (const cond of requirement.conditions) {
      if (cond.operator === "within_km") {
        if (distanceKm > Number(cond.value)) {
          return {
            proof_type: "gps_photo",
            passed: false,
            details:
              `GPS ${lat.toFixed(4)}, ${lon.toFixed(4)} is ${distanceKm.toFixed(1)}km ` +
              `from expected ${step.location.name} (max: ${cond.value}km)`,
          };
        }
      }
    }
  }

  return {
    proof_type: "gps_photo",
    passed: true,
    details:
      `GPS verified: ${lat.toFixed(4)}, ${lon.toFixed(4)} is ${distanceKm.toFixed(1)}km ` +
      `from ${step.location.name}`,
  };
}

function checkTlsnApiProof(
  proof: StepProof,
  _step: SupplyChainStep,
  requirement: RequiredProof | undefined,
): ProofCheckResult {
  const data = proof.data as Record<string, unknown>;
  const serverName = data.server_name as string | undefined;
  const revealedBody = data.revealed_body as string | undefined;
  const sessionTimestamp = data.session_timestamp as number | undefined;

  if (!serverName || !revealedBody) {
    return {
      proof_type: "tlsn_api",
      passed: false,
      details: "TLSNotary proof missing server_name or revealed_body",
    };
  }

  if (!sessionTimestamp) {
    return {
      proof_type: "tlsn_api",
      passed: false,
      details: "TLSNotary proof missing session_timestamp",
    };
  }

  // Check requirement conditions against the revealed body
  if (requirement) {
    for (const cond of requirement.conditions) {
      const fieldValue = data[cond.field] ?? extractJsonPath(revealedBody, cond.field);
      if (!evaluateCondition(fieldValue, cond.operator, cond.value)) {
        return {
          proof_type: "tlsn_api",
          passed: false,
          details:
            `TLSNotary condition failed: ${cond.field} ${cond.operator} ${cond.value} ` +
            `(actual: ${fieldValue})`,
        };
      }
    }
  }

  return {
    proof_type: "tlsn_api",
    passed: true,
    details: `TLSNotary verified: ${serverName} at ${new Date(sessionTimestamp * 1000).toISOString()}`,
  };
}

function checkC2paMediaProof(
  proof: StepProof,
  _step: SupplyChainStep,
  _requirement: RequiredProof | undefined,
): ProofCheckResult {
  const data = proof.data as Record<string, unknown>;
  const signer = data.signer as string | undefined;
  const signatureTime = data.signature_time as number | undefined;

  if (!signer) {
    return {
      proof_type: "c2pa_media",
      passed: false,
      details: "C2PA manifest missing signer information",
    };
  }

  if (!signatureTime) {
    return {
      proof_type: "c2pa_media",
      passed: false,
      details: "C2PA manifest missing signature_time",
    };
  }

  return {
    proof_type: "c2pa_media",
    passed: true,
    details: `C2PA verified: signed by ${signer} at ${new Date(signatureTime * 1000).toISOString()}`,
  };
}

function checkTemperatureLogProof(
  proof: StepProof,
  _step: SupplyChainStep,
  requirement: RequiredProof | undefined,
): ProofCheckResult {
  const data = proof.data as Record<string, unknown>;
  const readings = data.readings as Array<{ celsius: number; timestamp: number }> | undefined;

  if (!readings || readings.length === 0) {
    return {
      proof_type: "temperature_log",
      passed: false,
      details: "Temperature log has no readings",
    };
  }

  // Check conditions (e.g. all readings below a max temperature)
  if (requirement) {
    for (const cond of requirement.conditions) {
      if (cond.field === "celsius") {
        for (const reading of readings) {
          if (!evaluateCondition(reading.celsius, cond.operator, cond.value)) {
            return {
              proof_type: "temperature_log",
              passed: false,
              details:
                `Temperature violation: ${reading.celsius}C at ` +
                `${new Date(reading.timestamp * 1000).toISOString()} ` +
                `(required: ${cond.operator} ${cond.value}C)`,
            };
          }
        }
      }
    }
  }

  const minC = Math.min(...readings.map((r) => r.celsius));
  const maxC = Math.max(...readings.map((r) => r.celsius));

  return {
    proof_type: "temperature_log",
    passed: true,
    details: `Temperature log verified: ${readings.length} readings, range ${minC}C-${maxC}C`,
  };
}

// ---------------------------------------------------------------------------
// JSON path extraction (minimal, for TLSNotary body inspection)
// ---------------------------------------------------------------------------

function extractJsonPath(body: string, path: string): unknown {
  try {
    const obj = JSON.parse(body);
    return path.split(".").reduce((acc: unknown, key: string) => {
      if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Step verification
// ---------------------------------------------------------------------------

function findRequirement(
  requirements: StepRequirement[],
  stepType: string,
): StepRequirement | undefined {
  return requirements.find((r) => r.step_type === stepType);
}

function findRequiredProof(
  requirement: StepRequirement | undefined,
  proofType: string,
): RequiredProof | undefined {
  return requirement?.required_proofs.find((rp) => rp.proof_type === proofType);
}

function verifyStepProofs(
  step: SupplyChainStep,
  requirements: StepRequirement[],
): StepVerificationResult {
  const requirement = findRequirement(requirements, step.step_type);
  const proofResults: ProofCheckResult[] = [];
  const issues: string[] = [];

  // Check each proof attached to this step
  for (const proof of step.proofs) {
    const reqProof = findRequiredProof(requirement, proof.type);
    let result: ProofCheckResult;

    switch (proof.type) {
      case "gps_photo":
        result = checkGpsPhotoProof(proof, step, reqProof);
        break;
      case "tlsn_api":
        result = checkTlsnApiProof(proof, step, reqProof);
        break;
      case "c2pa_media":
        result = checkC2paMediaProof(proof, step, reqProof);
        break;
      case "temperature_log":
        result = checkTemperatureLogProof(proof, step, reqProof);
        break;
      default:
        result = {
          proof_type: proof.type,
          passed: false,
          details: `Unknown proof type: ${proof.type}`,
        };
    }

    proofResults.push(result);
    if (!result.passed) {
      issues.push(result.details);
    }
  }

  // Check for missing required proofs
  if (requirement) {
    for (const reqProof of requirement.required_proofs) {
      const hasProof = step.proofs.some((p) => p.type === reqProof.proof_type);
      if (!hasProof) {
        issues.push(`Missing required proof: ${reqProof.proof_type} for ${step.step_type}`);
        proofResults.push({
          proof_type: reqProof.proof_type,
          passed: false,
          details: `Required ${reqProof.proof_type} proof not provided`,
        });
      }
    }
  }

  const allPassed = proofResults.length > 0 && proofResults.every((r) => r.passed);
  const verdict: StepVerdict = proofResults.length === 0
    ? "skip"
    : allPassed
    ? "pass"
    : "fail";

  return {
    step_id: step.id,
    step_type: step.step_type,
    verdict,
    proof_results: proofResults,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Chain integrity checks
// ---------------------------------------------------------------------------

function verifyChainIntegrity(steps: SupplyChainStep[]): {
  intact: boolean;
  issues: string[];
} {
  if (steps.length === 0) {
    return { intact: false, issues: ["No steps in supply chain"] };
  }

  const issues: string[] = [];
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  // The first step (origin) should have no previous_step_id
  const originSteps = steps.filter((s) => !s.previous_step_id);
  if (originSteps.length === 0) {
    issues.push("No origin step found (step without previous_step_id)");
  } else if (originSteps.length > 1) {
    issues.push(
      `Multiple origin steps found: ${originSteps.map((s) => s.id).join(", ")}`,
    );
  }

  // Every non-origin step must reference a valid previous step
  for (const step of steps) {
    if (step.previous_step_id) {
      if (!stepMap.has(step.previous_step_id)) {
        issues.push(
          `Step ${step.id} references unknown previous step ${step.previous_step_id}`,
        );
      }
    }
  }

  return { intact: issues.length === 0, issues };
}

function verifyTimeOrdering(steps: SupplyChainStep[]): {
  ordered: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Build the chain order by following previous_step_id links
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const origin = steps.find((s) => !s.previous_step_id);
  if (!origin) {
    return { ordered: false, issues: ["Cannot check time ordering without origin step"] };
  }

  // Walk the chain
  const ordered: SupplyChainStep[] = [origin];
  const visited = new Set<string>([origin.id]);
  let current = origin;

  while (true) {
    const next = steps.find(
      (s) => s.previous_step_id === current.id && !visited.has(s.id),
    );
    if (!next) break;
    ordered.push(next);
    visited.add(next.id);
    current = next;
  }

  // Check chronological order
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (curr.timestamp < prev.timestamp) {
      issues.push(
        `Time violation: step ${curr.id} (${curr.step_type}, ` +
          `${new Date(curr.timestamp * 1000).toISOString()}) is earlier than ` +
          `step ${prev.id} (${prev.step_type}, ` +
          `${new Date(prev.timestamp * 1000).toISOString()})`,
      );
    }
  }

  return { ordered: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Trust score calculation
// ---------------------------------------------------------------------------

/**
 * Calculate a trust score 0-100 based on:
 *   - 40 points: chain integrity
 *   - 30 points: proof completeness and validity
 *   - 20 points: time ordering
 *   - 10 points: proof diversity (more proof types = higher confidence)
 */
function calculateTrustScore(
  stepResults: StepVerificationResult[],
  chainIntact: boolean,
  timeOrdered: boolean,
): number {
  let score = 0;

  // Chain integrity: 40 points
  if (chainIntact) score += 40;

  // Time ordering: 20 points
  if (timeOrdered) score += 20;

  // Proof validity: 30 points (proportional to passing proofs)
  if (stepResults.length > 0) {
    const totalProofs = stepResults.reduce(
      (sum, r) => sum + r.proof_results.length,
      0,
    );
    const passedProofs = stepResults.reduce(
      (sum, r) => sum + r.proof_results.filter((p) => p.passed).length,
      0,
    );
    if (totalProofs > 0) {
      score += Math.round(30 * (passedProofs / totalProofs));
    }
  }

  // Proof diversity: 10 points
  const proofTypes = new Set<string>();
  for (const r of stepResults) {
    for (const p of r.proof_results) {
      if (p.passed) proofTypes.add(p.proof_type);
    }
  }
  // 4 proof types max => 2.5 points each
  score += Math.min(10, Math.round(proofTypes.size * 2.5));

  return Math.min(100, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify an entire supply chain product.
 *
 * Returns a detailed report including per-step results, chain integrity,
 * time ordering, and an overall trust score.
 */
export function verifySupplyChain(
  product: SupplyChainProduct,
): ChainVerificationReport {
  const { steps, verification_requirements } = product;

  // 1. Verify each step's proofs
  const stepResults = steps.map((step) =>
    verifyStepProofs(step, verification_requirements)
  );

  // 2. Verify chain integrity
  const chainCheck = verifyChainIntegrity(steps);

  // 3. Verify time ordering
  const timeCheck = verifyTimeOrdering(steps);

  // 4. Calculate trust score
  const trustScore = calculateTrustScore(
    stepResults,
    chainCheck.intact,
    timeCheck.ordered,
  );

  // 5. Calculate released sats
  let totalSatsReleased = 0;
  for (const result of stepResults) {
    if (result.verdict === "pass") {
      const req = findRequirement(verification_requirements, result.step_type);
      if (req?.payment_condition?.release_on_verification) {
        totalSatsReleased += req.payment_condition.amount_sats;
      }
    }
  }

  // Append chain/time issues to the relevant step results for reporting
  if (chainCheck.issues.length > 0) {
    for (const issue of chainCheck.issues) {
      stepResults[0]?.issues.push(`[chain] ${issue}`);
    }
  }
  if (timeCheck.issues.length > 0) {
    for (const issue of timeCheck.issues) {
      stepResults[0]?.issues.push(`[time] ${issue}`);
    }
  }

  return {
    product_id: product.id,
    product_name: product.name,
    trust_score: trustScore,
    chain_intact: chainCheck.intact,
    time_ordered: timeCheck.ordered,
    step_results: stepResults,
    total_sats_released: totalSatsReleased,
    verified_at: Math.floor(Date.now() / 1000),
  };
}

// ---------------------------------------------------------------------------
// Pretty printer (for CLI usage)
// ---------------------------------------------------------------------------

export function printReport(report: ChainVerificationReport): void {
  console.log("=".repeat(70));
  console.log(`  Supply Chain Verification Report`);
  console.log(`  Product: ${report.product_name} (${report.product_id})`);
  console.log("=".repeat(70));
  console.log();
  console.log(`  Trust Score:    ${report.trust_score}/100`);
  console.log(`  Chain Intact:   ${report.chain_intact ? "YES" : "NO"}`);
  console.log(`  Time Ordered:   ${report.time_ordered ? "YES" : "NO"}`);
  console.log(`  Sats Released:  ${report.total_sats_released}`);
  console.log(`  Verified At:    ${new Date(report.verified_at * 1000).toISOString()}`);
  console.log();

  for (const step of report.step_results) {
    const icon = step.verdict === "pass" ? "[PASS]" : step.verdict === "fail" ? "[FAIL]" : "[SKIP]";
    console.log(`  ${icon} Step: ${step.step_type} (${step.step_id})`);
    for (const proof of step.proof_results) {
      const mark = proof.passed ? "  + " : "  - ";
      console.log(`${mark}${proof.details}`);
    }
    for (const issue of step.issues) {
      console.log(`  ! ${issue}`);
    }
    console.log();
  }

  console.log("=".repeat(70));
}
