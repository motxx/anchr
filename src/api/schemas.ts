import { z } from "zod";

export const requesterMetaSchema = z.object({
  requester_type: z.enum(["agent", "human", "app"]),
  requester_id: z.string().min(1).optional(),
  client_name: z.string().min(1).optional(),
});

export const bountySchema = z.object({
  amount_sats: z.number().int().min(1),
  cashu_token: z.string().min(1).optional(),
});

export const createQuerySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("photo_proof"),
    target: z.string().min(1),
    location_hint: z.string().min(1).optional(),
    ttl_seconds: z.number().int().min(60).max(86_400).optional(),
    requester: requesterMetaSchema.optional(),
    bounty: bountySchema.optional(),
  }),
  z.object({
    type: z.literal("store_status"),
    store_name: z.string().min(1),
    location_hint: z.string().min(1).optional(),
    ttl_seconds: z.number().int().min(60).max(86_400).optional(),
    requester: requesterMetaSchema.optional(),
    bounty: bountySchema.optional(),
  }),
  z.object({
    type: z.literal("webpage_field"),
    url: z.string().url(),
    field: z.string().min(1),
    anchor_word: z.string().min(1),
    ttl_seconds: z.number().int().min(60).max(86_400).optional(),
    requester: requesterMetaSchema.optional(),
    bounty: bountySchema.optional(),
  }),
]);
