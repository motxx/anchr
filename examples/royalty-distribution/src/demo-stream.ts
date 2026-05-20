/**
 * Royalty Distribution — minimal simulated demo.
 *
 * One song, three right holders, one streaming report → three verified
 * distribution edges. Proofs are mocked; the real wiring would attach
 * TLSNotary presentations against platform, recognition, and rights
 * APIs.
 *
 * Run:
 *   deno run --allow-all examples/royalty-distribution/src/demo-stream.ts
 */

import type {
  Content,
  ContentRights,
  DistributionEdge,
  DistributionReport,
  EdgeProof,
  UseEvent,
} from "./royalty-types.ts";

const song: Content = {
  id: "sha256:song-x-2026-q1",
  title: "Song X",
};

const songRights: ContentRights = {
  content_id: song.id,
  holders: [
    { type: "composer", holder_pubkey: "pk_composer_a", share_bps: 4_000 },
    { type: "performer", holder_pubkey: "pk_performer_b", share_bps: 3_000 },
    { type: "producer", holder_pubkey: "pk_producer_c", share_bps: 3_000 },
  ],
};

const platformReport: UseEvent = {
  content_id: song.id,
  platform: "ExampleStream",
  use_type: "stream",
  volume: 12_345, // play count this period
  period_start: 1_711_929_600, // 2026-04-01
  period_end: 1_714_521_600, // 2026-05-01
};

const RATE_SATS_PER_USE = 1;

function buildEdges(
  use: UseEvent,
  rights: ContentRights,
  ratePerUse: number,
): DistributionEdge[] {
  const totalSats = use.volume * ratePerUse;
  return rights.holders.map((holder, i): DistributionEdge => {
    const proof: EdgeProof = {
      use_proof: `tlsn:platform_report:${use.platform}:${use.content_id}`,
      identity_proof: `tlsn:recognition_api:${use.content_id}`,
      rights_proof:
        `tlsn:rights_db:${rights.content_id}:${holder.holder_pubkey}`,
    };
    return {
      edge_id: `edge_${use.content_id}_${i}`,
      use_event: use,
      from_pubkey: `pk_platform_${use.platform.toLowerCase()}`,
      to_pubkey: holder.holder_pubkey,
      amount_sats: Math.floor((totalSats * holder.share_bps) / 10_000),
      proof,
    };
  });
}

// Wired build calls Anchr's TLSN verifier; demo trusts the constructed proofs.
function verifyEdges(edges: DistributionEdge[]): boolean {
  return edges.every((e) => {
    const p = e.proof;
    return Boolean(p.use_proof && p.rights_proof);
  });
}

function buildReport(
  use: UseEvent,
  edges: DistributionEdge[],
): DistributionReport {
  return {
    use_event: use,
    edges,
    total_distributed_sats: edges.reduce((s, e) => s + e.amount_sats, 0),
    all_proofs_verified: verifyEdges(edges),
    audit_trail_intact: true,
  };
}

const edges = buildEdges(platformReport, songRights, RATE_SATS_PER_USE);
const report = buildReport(platformReport, edges);

console.log("=".repeat(70));
console.log("  Royalty Distribution — Streaming Demo (simulated)");
console.log(`  Content: ${song.title} (${song.id})`);
console.log(`  Use: ${platformReport.use_type} on ${platformReport.platform}`);
console.log(`  Volume: ${platformReport.volume.toLocaleString()} plays`);
console.log("=".repeat(70));
console.log();

for (const edge of report.edges) {
  const holder = songRights.holders.find((h) =>
    h.holder_pubkey === edge.to_pubkey
  )!;
  console.log(
    `  ${holder.type.padEnd(10)} → ${edge.to_pubkey.padEnd(20)} ${
      edge.amount_sats.toLocaleString().padStart(8)
    } sats  (${holder.share_bps / 100}%)`,
  );
}

console.log();
console.log(
  `  Total distributed:    ${report.total_distributed_sats.toLocaleString()} sats`,
);
console.log(
  `  All proofs verified:  ${report.all_proofs_verified ? "YES" : "NO"}`,
);
console.log(
  `  Audit trail intact:   ${report.audit_trail_intact ? "YES" : "NO"}`,
);
console.log();
console.log("  (proofs are simulated; real wiring would attach TLSNotary");
console.log("   presentations against platform, recognition, and rights APIs)");
