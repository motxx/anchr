import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  registerSchemaBundle,
  resolveProofGenerator,
  resolveVerifierAdapter,
  type SchemaBundle,
  type SchemaEvidencePayload,
  type SchemaProducer,
  type SchemaVerifier,
} from "@anchr/sdk";
import { verifyProof } from "@anchr/sdk/proofs";
import { createPreimageStore } from "@anchr/sdk/payments";
import {
  createMockEscrowProvider,
  createOracleRegistry,
  createQueryService,
  makeEscrowInfo,
  makeFakeToken,
  type Oracle,
  type OracleAttestation,
  type Query,
  type QueryResult,
} from "@anchr/sdk/testing";

const CUSTOM_SCHEMA_URI = "https://example.test/spec/proof/custom/v1";
const CUSTOM_ORACLE_ID = "custom-schema-oracle";
const CUSTOM_CUSTOMER_PUBKEY = "customer_pub";
const CUSTOM_NONCE = "custom-nonce-0161";

interface CustomRequirement {
  target: string;
  customer_pubkey: string;
}

interface CustomEvidenceData {
  target: string;
  customer_pubkey: string;
  nonce: string;
}

interface CustomSchemaEvidence extends SchemaEvidencePayload {
  data: CustomEvidenceData;
  proof: string;
}

const CUSTOM_REQUIREMENT: CustomRequirement = {
  target: "paid-request-0161",
  customer_pubkey: CUSTOM_CUSTOMER_PUBKEY,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCustomRequirement(value: unknown): value is CustomRequirement {
  return isRecord(value) &&
    typeof value.target === "string" &&
    typeof value.customer_pubkey === "string";
}

function isCustomEvidenceData(value: unknown): value is CustomEvidenceData {
  return isRecord(value) &&
    typeof value.target === "string" &&
    typeof value.customer_pubkey === "string" &&
    typeof value.nonce === "string";
}

function isCustomSchemaEvidence(
  value: unknown,
): value is CustomSchemaEvidence {
  return isRecord(value) &&
    isCustomEvidenceData(value.data) &&
    typeof value.proof === "string";
}

function proofFor(data: CustomEvidenceData): string {
  return [
    "custom-proof",
    data.target,
    data.customer_pubkey,
    data.nonce,
  ].join(":");
}

const customProducer: SchemaProducer = (predicate, context) => {
  if (!isCustomRequirement(predicate)) {
    throw new Error("custom schema predicate must be a CustomRequirement");
  }
  if (context.customerPubkey !== predicate.customer_pubkey) {
    throw new Error("custom schema producer received the wrong customer");
  }

  const data: CustomEvidenceData = {
    target: predicate.target,
    customer_pubkey: context.customerPubkey,
    nonce: CUSTOM_NONCE,
  };
  return Promise.resolve({ data, proof: proofFor(data) });
};

const customVerifier: SchemaVerifier = (proof, predicate, data) => {
  if (
    typeof proof !== "string" ||
    !isCustomRequirement(predicate) ||
    !isCustomEvidenceData(data)
  ) {
    return false;
  }

  return data.target === predicate.target &&
    data.customer_pubkey === predicate.customer_pubkey &&
    proof === proofFor(data);
};

const customSchemaBundle: SchemaBundle = {
  uri: CUSTOM_SCHEMA_URI,
  producer: customProducer,
  verifier: customVerifier,
  checks: [{
    name: "custom-schema-evidence",
    async run(ctx) {
      if (!isCustomRequirement(ctx.requirement.schema_requirement)) {
        ctx.acc.failures.push(
          "custom schema_requirement missing or invalid",
        );
        return;
      }
      if (!isCustomSchemaEvidence(ctx.input.schema_evidence)) {
        ctx.acc.failures.push("custom schema_evidence missing or invalid");
        return;
      }

      const verified = await customVerifier(
        ctx.input.schema_evidence.proof,
        ctx.requirement.schema_requirement,
        ctx.input.schema_evidence.data,
        { options: ctx.schemaOptions },
      );
      if (!verified) {
        ctx.acc.failures.push("custom schema verifier rejected evidence");
        return;
      }

      ctx.acc.checks.push("custom schema evidence accepted");
      ctx.schemaVerdict = {
        target: ctx.input.schema_evidence.data.target,
        nonce: ctx.input.schema_evidence.data.nonce,
      };
    },
  }],
};

function createCustomSchemaOracle(): Oracle {
  return {
    info: { id: CUSTOM_ORACLE_ID, name: "Custom schema oracle", fee_ppm: 0 },
    async verify(
      query: Query,
      result: QueryResult,
    ): Promise<OracleAttestation> {
      const verification = await verifyProof(
        {
          id: query.id,
          schema: query.schema,
          factors: query.verification_requirements,
          description: query.description,
          challenge_nonce: query.challenge_nonce,
          schema_requirement: query.schema_requirement,
        },
        {
          attachments: result.attachments,
          schema_evidence: result.schema_evidence,
        },
      );

      return {
        oracle_id: CUSTOM_ORACLE_ID,
        query_id: query.id,
        passed: verification.passed,
        checks: verification.checks,
        failures: verification.failures,
        attested_at: Date.now(),
        schema_verdict: verification.schema_verdict,
      };
    },
  };
}

async function produceCustomEvidence(): Promise<SchemaEvidencePayload> {
  const generator = resolveProofGenerator([], CUSTOM_SCHEMA_URI);
  expect(generator).not.toBeNull();
  if (generator === null) {
    throw new Error("custom schema producer was not registered");
  }

  const evidence = await generator.produce(CUSTOM_REQUIREMENT, {
    customerPubkey: CUSTOM_CUSTOMER_PUBKEY,
  });

  const verifier = resolveVerifierAdapter([], CUSTOM_SCHEMA_URI);
  expect(verifier).not.toBeNull();
  if (verifier === null) {
    throw new Error("custom schema verifier was not registered");
  }
  expect(
    await verifier.verify(
      evidence.proof,
      CUSTOM_REQUIREMENT,
      evidence.data,
    ),
  ).toBe(true);

  return evidence;
}

async function submitPaidCustomSchemaResult(schemaEvidence?: unknown) {
  const preimageStore = createPreimageStore();
  const registry = createOracleRegistry();
  registry.register(createCustomSchemaOracle());
  const service = createQueryService({
    oracleRegistry: registry,
    preimageStore,
    escrowProvider: createMockEscrowProvider(),
  });
  const { escrowInfo, entry } = await makeEscrowInfo(preimageStore);
  const providerPubkey = "provider_pub";
  const query = service.createQuery(
    {
      description: "Custom schema paid request",
      schema: CUSTOM_SCHEMA_URI,
      schema_requirement: CUSTOM_REQUIREMENT,
    },
    {
      escrow: escrowInfo,
      payment_lock: { amount_sats: 100 },
      oracleIds: [CUSTOM_ORACLE_ID],
    },
  );

  expect(
    service.recordOffer(query.id, {
      provider_pubkey: providerPubkey,
      offer_event_id: "offer_custom_schema",
      received_at: Date.now(),
    }).ok,
  ).toBe(true);
  expect(
    await service.selectProvider(
      query.id,
      providerPubkey,
      makeFakeToken(100),
    ),
  ).toMatchObject({ ok: true });
  expect(service.beginWork(query.id).ok).toBe(true);

  const outcome = await service.submitEscrowResult(
    query.id,
    { attachments: [], schema_evidence: schemaEvidence },
    providerPubkey,
    CUSTOM_ORACLE_ID,
  );

  return {
    outcome,
    entry,
    query: service.getQuery(query.id),
    preimageStore,
  };
}

describe("custom schema bundle e2e", () => {
  test("registered custom producer, verifier, and check release a paid request", async () => {
    const unregister = registerSchemaBundle(customSchemaBundle);
    try {
      const evidence = await produceCustomEvidence();
      const { outcome, entry, query } = await submitPaidCustomSchemaResult(
        evidence,
      );

      expect(outcome.ok).toBe(true);
      expect(outcome.preimage).toBe(entry.preimage);
      expect(query?.status).toBe("approved");
      expect(query?.payment_status).toBe("released");
      expect(query?.verification?.passed).toBe(true);
      expect(query?.verification?.checks).toContain(
        "custom schema evidence accepted",
      );
      expect(query?.verification?.failures).toEqual([]);
      expect(query?.verification?.schema_verdict).toEqual({
        target: CUSTOM_REQUIREMENT.target,
        nonce: CUSTOM_NONCE,
      });
    } finally {
      unregister();
    }
  });

  test("registered custom check fails closed when evidence is missing", async () => {
    const unregister = registerSchemaBundle(customSchemaBundle);
    try {
      const { outcome, entry, query, preimageStore } =
        await submitPaidCustomSchemaResult();

      expect(outcome.ok).toBe(false);
      expect(outcome.preimage).toBeUndefined();
      expect(query?.status).toBe("rejected");
      expect(query?.payment_status).toBe("cancelled");
      expect(query?.verification?.passed).toBe(false);
      expect(query?.verification?.failures).toContain(
        "custom schema_evidence missing or invalid",
      );
      expect(await preimageStore.getPreimage(entry.hash)).toBe(entry.preimage);
    } finally {
      unregister();
    }
  });

  test("registered custom verifier rejects tampered evidence", async () => {
    const unregister = registerSchemaBundle(customSchemaBundle);
    try {
      const evidence = await produceCustomEvidence();
      const tampered = isCustomSchemaEvidence(evidence)
        ? { ...evidence, proof: "tampered-proof" }
        : evidence;
      const { outcome, entry, query, preimageStore } =
        await submitPaidCustomSchemaResult(tampered);

      expect(outcome.ok).toBe(false);
      expect(outcome.preimage).toBeUndefined();
      expect(query?.status).toBe("rejected");
      expect(query?.payment_status).toBe("cancelled");
      expect(query?.verification?.passed).toBe(false);
      expect(query?.verification?.failures).toContain(
        "custom schema verifier rejected evidence",
      );
      expect(await preimageStore.getPreimage(entry.hash)).toBe(entry.preimage);
    } finally {
      unregister();
    }
  });
});
