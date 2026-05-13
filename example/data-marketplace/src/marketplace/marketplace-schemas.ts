import { z } from "zod";

const tlsnConditionSchema = z.object({
  type: z.enum(["contains", "regex", "jsonpath"]),
  expression: z.string().min(1),
  expected: z.string().optional(),
  description: z.string().optional(),
});

const tlsnRequirementSchema = z.object({
  target_url: z.string().url(),
  method: z.enum(["GET", "POST"]).optional(),
  conditions: z.array(tlsnConditionSchema).optional(),
  max_attestation_age_seconds: z.number().int().min(60).max(86_400)
    .optional(),
  domain_hint: z.string().optional(),
});

export const createListingSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  source_url: z.string().url(),
  price_sats: z.number().int().min(1),
  htlc_price_sats: z.number().int().min(1),
  tlsn_requirement: tlsnRequirementSchema,
  max_age_seconds: z.number().int().min(10).max(86_400).default(300),
  provider_pubkey: z.string().min(1).optional(),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
