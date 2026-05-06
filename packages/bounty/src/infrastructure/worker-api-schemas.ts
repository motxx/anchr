import { z } from "zod";
import {
  VERIFICATION_FACTORS,
  type VerificationFactor,
} from "../domain/types.ts";

export interface RequesterMetaBody {
  requester_type: "agent" | "human" | "app";
  requester_id?: string;
  client_name?: string;
}

export interface BountyBody {
  amount_sats: number;
  escrow_token?: string;
}

export interface GpsBody {
  lat: number;
  lon: number;
}

export interface HtlcEscrowBody {
  type: "htlc";
  hash: string;
  oracle_pubkeys: string[];
  requester_pubkey: string;
  locktime: number;
  escrow_token?: string;
}

export interface P2pkFrostEscrowBody {
  type: "p2pk_frost";
  group_pubkey: string;
  oracle_pubkeys: string[];
  requester_pubkey: string;
  locktime: number;
  escrow_token?: string;
}

export type EscrowBody = HtlcEscrowBody | P2pkFrostEscrowBody;

export interface TlsnConditionBody {
  type: "contains" | "regex" | "jsonpath";
  expression: string;
  expected?: string;
  description?: string;
}

export interface TlsnRequirementBody {
  target_url: string;
  method?: "GET" | "POST";
  conditions?: TlsnConditionBody[];
  max_attestation_age_seconds?: number;
  domain_hint?: string;
}

export interface QuorumBody {
  min_approvals: number;
}

export type ProofVisibilityBody = "public" | "requester_only";

export interface CreateQueryBody {
  description: string;
  location_hint?: string;
  expected_gps?: GpsBody;
  max_gps_distance_km?: number;
  ttl_seconds?: number;
  requester?: RequesterMetaBody;
  bounty?: BountyBody;
  oracle_ids?: string[];
  escrow?: EscrowBody;
  verification_requirements?: VerificationFactor[];
  tlsn_requirements?: TlsnRequirementBody;
  quorum?: QuorumBody;
  visibility?: ProofVisibilityBody;
}

export interface AttachmentRefBody {
  id: string;
  uri: string;
  mime_type?: string;
  storage_kind?: string;
  filename?: string;
  size_bytes?: number;
  blossom_hash?: string;
  blossom_servers?: string[];
}

export interface ResultBody {
  worker_pubkey: string;
  attachments: AttachmentRefBody[];
  notes?: string;
  gps?: GpsBody;
  tlsn_presentation?: string;
  tlsn_attestation?: { presentation: string };
  tlsn_extension_result?: Record<string, unknown>;
  encryption_keys?: Record<string, unknown>;
  oracle_id?: string;
}

export const requesterMetaSchema: z.ZodType<RequesterMetaBody> = z.object({
  requester_type: z.enum(["agent", "human", "app"]),
  requester_id: z.string().min(1).optional(),
  client_name: z.string().min(1).optional(),
});

export const bountySchema: z.ZodType<BountyBody> = z.object({
  amount_sats: z.number().int().min(1),
  escrow_token: z.string().min(1).optional(),
});

export const oracleIdsSchema: z.ZodType<string[] | undefined> = z.array(
  z.string().min(1),
).optional();

const escrowCommonFields: {
  oracle_pubkeys: z.ZodType<string[]>;
  requester_pubkey: z.ZodType<string>;
  locktime: z.ZodType<number>;
  escrow_token: z.ZodType<string | undefined>;
} = {
  oracle_pubkeys: z.array(z.string().min(1)).min(1),
  requester_pubkey: z.string().min(1),
  locktime: z.number().int().min(0),
  escrow_token: z.string().min(1).optional(),
};

const htlcEscrowObject = z.object({
  type: z.literal("htlc"),
  hash: z.string().min(1),
  ...escrowCommonFields,
});
export const htlcEscrowSchema: z.ZodType<HtlcEscrowBody> = htlcEscrowObject;

const p2pkFrostEscrowObject = z.object({
  type: z.literal("p2pk_frost"),
  group_pubkey: z.string().min(1),
  ...escrowCommonFields,
});
export const p2pkFrostEscrowSchema: z.ZodType<P2pkFrostEscrowBody> =
  p2pkFrostEscrowObject;

export const escrowSchema: z.ZodType<EscrowBody> = z.union([
  htlcEscrowObject,
  p2pkFrostEscrowObject,
]);

export const gpsSchema: z.ZodType<GpsBody> = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const verificationRequirementsSchema: z.ZodType<
  VerificationFactor[] | undefined
> = z.array(
  z.enum(VERIFICATION_FACTORS),
).optional();

export const tlsnConditionSchema: z.ZodType<TlsnConditionBody> = z.object({
  type: z.enum(["contains", "regex", "jsonpath"]),
  expression: z.string().min(1),
  expected: z.string().optional(),
  description: z.string().optional(),
});

export const tlsnRequirementSchema: z.ZodType<TlsnRequirementBody> = z.object({
  target_url: z.string().url(),
  method: z.enum(["GET", "POST"]).optional(),
  conditions: z.array(tlsnConditionSchema).optional(),
  max_attestation_age_seconds: z.number().int().min(60).max(86400).optional(),
  domain_hint: z.string().optional(),
});

export const quorumSchema: z.ZodType<QuorumBody> = z.object({
  min_approvals: z.number().int().min(1),
});

export const proofVisibilitySchema: z.ZodType<ProofVisibilityBody | undefined> =
  z.enum(["public", "requester_only"]).optional();

export const createQuerySchema: z.ZodType<CreateQueryBody> = z.object({
  description: z.string().min(1).max(5000),
  location_hint: z.string().min(1).max(500).optional(),
  expected_gps: gpsSchema.optional(),
  max_gps_distance_km: z.number().min(0.01).max(1000).optional(),
  ttl_seconds: z.number().int().min(60).max(86_400).optional(),
  requester: requesterMetaSchema.optional(),
  bounty: bountySchema.optional(),
  oracle_ids: oracleIdsSchema,
  escrow: escrowSchema.optional(),
  verification_requirements: verificationRequirementsSchema,
  tlsn_requirements: tlsnRequirementSchema.optional(),
  quorum: quorumSchema.optional(),
  visibility: proofVisibilitySchema,
});

export const attachmentRefSchema: z.ZodType<AttachmentRefBody> = z.object({
  id: z.string().min(1),
  uri: z.string().min(1),
  mime_type: z.string().min(1).optional(),
  storage_kind: z.string().optional(),
  filename: z.string().optional(),
  size_bytes: z.number().int().min(0).optional(),
  blossom_hash: z.string().optional(),
  blossom_servers: z.array(z.string()).optional(),
});

export const resultBodySchema: z.ZodType<ResultBody> = z.object({
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
