/**
 * Zod validation schemas for Marketplace API endpoints.
 * Reuses tlsn-related schemas from worker-api-schemas.
 */

import { z } from "zod";
import { tlsnRequirementSchema } from "../worker-api-schemas";

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
