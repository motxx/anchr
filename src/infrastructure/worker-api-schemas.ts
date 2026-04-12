import { z } from "zod";
import { VERIFICATION_FACTORS } from "../domain/types";

export const requesterMetaSchema = z.object({
  requester_type: z.enum(["agent", "human", "app"]),
  requester_id: z.string().min(1).optional(),
  client_name: z.string().min(1).optional(),
});

export const bountySchema = z.object({
  amount_sats: z.number().int().min(1),
  cashu_token: z.string().min(1).optional(),
});

export const oracleIdsSchema = z.array(z.string().min(1)).optional();

export const htlcSchema = z.object({
  hash: z.string().min(1),
  oracle_pubkey: z.string().min(1),
  requester_pubkey: z.string().min(1),
  locktime: z.number().int().min(0),
  escrow_token: z.string().min(1).optional(),
});

export const gpsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const verificationRequirementsSchema = z.array(
  z.enum(VERIFICATION_FACTORS),
).optional();

export const tlsnConditionSchema = z.object({
  type: z.enum(["contains", "regex", "jsonpath"]),
  expression: z.string().min(1),
  expected: z.string().optional(),
  description: z.string().optional(),
});

export const tlsnRequirementSchema = z.object({
  target_url: z.string().url(),
  method: z.enum(["GET", "POST"]).optional(),
  conditions: z.array(tlsnConditionSchema).optional(),
  max_attestation_age_seconds: z.number().int().min(60).max(86400).optional(),
  domain_hint: z.string().optional(),
});

export const quorumSchema = z.object({
  min_approvals: z.number().int().min(1),
});

export const proofVisibilitySchema = z.enum(["public", "requester_only"]).optional();

export const createQuerySchema = z.object({
  description: z.string().min(1).max(5000),
  location_hint: z.string().min(1).max(500).optional(),
  expected_gps: gpsSchema.optional(),
  max_gps_distance_km: z.number().min(0.01).max(1000).optional(),
  ttl_seconds: z.number().int().min(60).max(86_400).optional(),
  requester: requesterMetaSchema.optional(),
  bounty: bountySchema.optional(),
  oracle_ids: oracleIdsSchema,
  htlc: htlcSchema.optional(),
  verification_requirements: verificationRequirementsSchema,
  tlsn_requirements: tlsnRequirementSchema.optional(),
  quorum: quorumSchema.optional(),
  visibility: proofVisibilitySchema,
});

export const attachmentRefSchema = z.object({
  id: z.string().min(1),
  uri: z.string().min(1),
  mime_type: z.string().min(1).optional(),
  storage_kind: z.string().optional(),
  filename: z.string().optional(),
  size_bytes: z.number().int().min(0).optional(),
  blossom_hash: z.string().optional(),
  blossom_servers: z.array(z.string()).optional(),
});

export const resultBodySchema = z.object({
  worker_pubkey: z.string().min(1),
  attachments: z.array(attachmentRefSchema).default([]),
  notes: z.string().optional(),
  gps: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }).optional(),
  tlsn_presentation: z.string().optional(),
  tlsn_attestation: z.object({ presentation: z.string().min(1) }).optional(),
  tlsn_extension_result: z.record(z.string(), z.unknown()).optional(),
  encryption_keys: z.record(z.string(), z.unknown()).optional(),
  oracle_id: z.string().optional(),
});
