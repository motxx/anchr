/**
 * Supply Chain Proof — Coffee Demo
 *
 * Traces a coffee shipment from a farm in Sao Paulo through processing in
 * Kawasaki to a cafe in Shibuya, with cryptographic proofs at every step.
 *
 * Each step uses Anchr's verification stack:
 *   - GPS + C2PA photos prove physical presence at each location
 *   - TLSNotary proves data from logistics APIs
 *   - Cashu HTLC enables conditional payments released on verification
 *   - Nostr provides the decentralized event log
 *
 * Usage:
 *   deno run --allow-all example/supply-chain-proof/src/demo-coffee.ts
 */

import type {
  StepRequirement,
  SupplyChainProduct,
  SupplyChainStep,
} from "./supply-chain-types.ts";
import { printReport, verifySupplyChain } from "./chain-verifier.ts";

// ---------------------------------------------------------------------------
// Real GPS coordinates
// ---------------------------------------------------------------------------

const GPS = {
  sao_paulo_farm: { lat: -23.5505, lon: -46.6333, name: "Coffee Farm, Sao Paulo, Brazil" },
  santos_port: { lat: -23.9608, lon: -46.3336, name: "Port of Santos, Brazil" },
  kawasaki_roaster: { lat: 35.5311, lon: 139.6978, name: "Roastery, Kawasaki, Japan" },
  shibuya_cafe: { lat: 35.6595, lon: 139.7004, name: "Cafe, Shibuya, Tokyo, Japan" },
} as const;

// ---------------------------------------------------------------------------
// Simulated actors (Nostr pubkeys are placeholders for the demo)
// ---------------------------------------------------------------------------

const ACTORS = {
  farmer: {
    name: "Fazenda Boa Vista",
    pubkey: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  },
  exporter: {
    name: "Santos Export Co.",
    pubkey: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
  },
  roaster: {
    name: "Tokyo Roast Lab",
    pubkey: "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  },
  cafe: {
    name: "Shibuya Coffee Stand",
    pubkey: "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
  },
} as const;

// ---------------------------------------------------------------------------
// Verification requirements for each step type
// ---------------------------------------------------------------------------

const COFFEE_REQUIREMENTS: StepRequirement[] = [
  {
    step_type: "origin",
    required_proofs: [
      {
        proof_type: "gps_photo",
        conditions: [{ field: "distance_km", operator: "within_km", value: 50 }],
      },
      {
        proof_type: "c2pa_media",
        conditions: [],
      },
    ],
    payment_condition: {
      amount_sats: 5_000,
      release_on_verification: true,
    },
  },
  {
    step_type: "transport",
    required_proofs: [
      {
        proof_type: "tlsn_api",
        conditions: [
          { field: "status", operator: "eq", value: "shipped" },
        ],
      },
    ],
    payment_condition: {
      amount_sats: 2_000,
      release_on_verification: true,
    },
  },
  {
    step_type: "processing",
    required_proofs: [
      {
        proof_type: "gps_photo",
        conditions: [{ field: "distance_km", operator: "within_km", value: 10 }],
      },
      {
        proof_type: "tlsn_api",
        conditions: [
          { field: "cupping_score", operator: "gt", value: 80 },
        ],
      },
    ],
    payment_condition: {
      amount_sats: 3_000,
      release_on_verification: true,
    },
  },
  {
    step_type: "retail",
    required_proofs: [
      {
        proof_type: "gps_photo",
        conditions: [{ field: "distance_km", operator: "within_km", value: 5 }],
      },
    ],
    payment_condition: {
      amount_sats: 1_000,
      release_on_verification: true,
    },
  },
];

// ---------------------------------------------------------------------------
// Simulated supply chain steps
// ---------------------------------------------------------------------------

function buildCoffeeSteps(): SupplyChainStep[] {
  const productId = "coffee-fazenda-lot-2026-03";
  const baseTime = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // 30 days ago

  // Step 1: Origin — Farmer photographs the harvest
  const step1: SupplyChainStep = {
    id: "step-001-origin",
    product_id: productId,
    step_type: "origin",
    actor: ACTORS.farmer,
    location: GPS.sao_paulo_farm,
    timestamp: baseTime,
    proofs: [
      {
        type: "gps_photo",
        data: {
          lat: -23.5510,
          lon: -46.6340,
          distance_km: 0.08,
          photo_hash: "sha256:a3f8c0d1e2b4a5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9",
          c2pa_manifest: "valid",
        },
        verified: true,
        verification_details: "C2PA-signed photo from ProofMode camera, GPS within 80m of farm",
      },
      {
        type: "c2pa_media",
        data: {
          signer: "ProofMode Camera / Guardian Project",
          signature_time: baseTime + 60,
          assertions: ["exif.gps", "stds.schema-org.CreativeWork"],
          camera_make: "Samsung",
          camera_model: "Galaxy S24",
        },
        verified: true,
        verification_details: "C2PA Content Credential chain valid, hardware-rooted signature",
      },
    ],
    nostr_event_id: "evt_origin_001",
  };

  // Step 2: Transport — Exporter ships from Santos port
  const step2: SupplyChainStep = {
    id: "step-002-transport",
    product_id: productId,
    step_type: "transport",
    actor: ACTORS.exporter,
    location: GPS.santos_port,
    timestamp: baseTime + 3 * 24 * 60 * 60, // 3 days later
    proofs: [
      {
        type: "tlsn_api",
        data: {
          server_name: "api.maersk.com",
          revealed_body: JSON.stringify({
            tracking_number: "MAEU-2026-BR-JP-4821",
            status: "shipped",
            origin_port: "Santos, BR",
            destination_port: "Yokohama, JP",
            vessel: "Maersk Sealand",
            estimated_arrival: "2026-04-01",
            container_temp_celsius: 18,
          }),
          session_timestamp: baseTime + 3 * 24 * 60 * 60 + 3600,
          status: "shipped",
        },
        verified: true,
        verification_details:
          "TLSNotary proof: Maersk API confirms shipment MAEU-2026-BR-JP-4821 status=shipped",
      },
    ],
    previous_step_id: "step-001-origin",
    nostr_event_id: "evt_transport_002",
  };

  // Step 3: Processing — Roaster in Kawasaki receives and cups the coffee
  const step3: SupplyChainStep = {
    id: "step-003-processing",
    product_id: productId,
    step_type: "processing",
    actor: ACTORS.roaster,
    location: GPS.kawasaki_roaster,
    timestamp: baseTime + 25 * 24 * 60 * 60, // 25 days later
    proofs: [
      {
        type: "gps_photo",
        data: {
          lat: 35.5315,
          lon: 139.6982,
          distance_km: 0.06,
          photo_hash: "sha256:b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4",
          c2pa_manifest: "valid",
        },
        verified: true,
        verification_details: "Photo at Kawasaki roastery, GPS within 60m",
      },
      {
        type: "tlsn_api",
        data: {
          server_name: "api.sca.coffee",
          revealed_body: JSON.stringify({
            lot_id: "fazenda-lot-2026-03",
            cupping_score: 87.5,
            flavor_notes: ["chocolate", "citrus", "caramel"],
            roast_profile: "medium",
            grader: "SCA Q-Grader #12045",
          }),
          session_timestamp: baseTime + 25 * 24 * 60 * 60 + 7200,
          cupping_score: 87.5,
        },
        verified: true,
        verification_details: "TLSNotary proof: SCA cupping score 87.5 by certified Q-Grader",
      },
    ],
    previous_step_id: "step-002-transport",
    nostr_event_id: "evt_processing_003",
  };

  // Step 4: Retail — Cafe in Shibuya receives final delivery
  const step4: SupplyChainStep = {
    id: "step-004-retail",
    product_id: productId,
    step_type: "retail",
    actor: ACTORS.cafe,
    location: GPS.shibuya_cafe,
    timestamp: baseTime + 28 * 24 * 60 * 60, // 28 days later
    proofs: [
      {
        type: "gps_photo",
        data: {
          lat: 35.6598,
          lon: 139.7008,
          distance_km: 0.05,
          photo_hash: "sha256:c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5",
        },
        verified: true,
        verification_details: "Photo at Shibuya cafe, GPS within 50m",
      },
    ],
    previous_step_id: "step-003-processing",
    nostr_event_id: "evt_retail_004",
  };

  return [step1, step2, step3, step4];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log();
  console.log("  Supply Chain Proof — Coffee Demo");
  console.log("  Sao Paulo -> Santos -> Kawasaki -> Shibuya");
  console.log();

  const product: SupplyChainProduct = {
    id: "coffee-fazenda-lot-2026-03",
    name: "Fazenda Boa Vista — Single Origin Lot 2026-03",
    category: "coffee",
    steps: buildCoffeeSteps(),
    verification_requirements: COFFEE_REQUIREMENTS,
  };

  console.log("  Building supply chain...");
  console.log(`  Product: ${product.name}`);
  console.log(`  Steps:   ${product.steps.length}`);
  console.log();

  // Print each step summary
  for (const step of product.steps) {
    const proofTypes = step.proofs.map((p) => p.type).join(", ");
    console.log(`  [${step.step_type.toUpperCase().padEnd(10)}] ${step.location.name}`);
    console.log(`    Actor:  ${step.actor.name}`);
    console.log(`    Proofs: ${proofTypes}`);
    console.log(`    Time:   ${new Date(step.timestamp * 1000).toISOString()}`);
    if (step.previous_step_id) {
      console.log(`    Prev:   ${step.previous_step_id}`);
    }
    console.log();
  }

  // Verify the full chain
  console.log("  Running verification...");
  console.log();

  const report = verifySupplyChain(product);
  printReport(report);

  // Cashu HTLC payment summary
  console.log();
  console.log("  Cashu HTLC Payment Summary");
  console.log("  " + "-".repeat(50));

  for (const step of product.steps) {
    const req = COFFEE_REQUIREMENTS.find((r) => r.step_type === step.step_type);
    const stepResult = report.step_results.find((r) => r.step_id === step.id);
    if (req?.payment_condition) {
      const released = stepResult?.verdict === "pass";
      const status = released ? "RELEASED" : "HELD";
      console.log(
        `  ${step.actor.name.padEnd(25)} ${req.payment_condition.amount_sats.toLocaleString().padStart(6)} sats  [${status}]`,
      );
      if (released) {
        console.log(
          `    -> HTLC preimage revealed, ${step.actor.name} can redeem from Cashu mint`,
        );
      }
    }
  }

  console.log("  " + "-".repeat(50));
  console.log(
    `  Total released: ${report.total_sats_released.toLocaleString()} sats`,
  );
  console.log();

  // Nostr event log
  console.log("  Nostr Event Log (decentralized audit trail)");
  console.log("  " + "-".repeat(50));
  for (const step of product.steps) {
    if (step.nostr_event_id) {
      console.log(
        `  ${step.nostr_event_id.padEnd(25)} ${step.step_type.padEnd(12)} ${step.location.name}`,
      );
    }
  }
  console.log();
}

main();
