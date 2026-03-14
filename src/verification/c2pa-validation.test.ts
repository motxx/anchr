import { test, expect, describe, beforeAll } from "bun:test";
import { validateC2pa, isC2paAvailable } from "./c2pa-validation";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a minimal JPEG buffer using sharp. */
async function createTestJpeg(): Promise<Buffer> {
  // Use variable to prevent TS static module resolution
  const sharpName = "sharp";
  const sharpMod = await import(sharpName);
  return sharpMod.default({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).jpeg().toBuffer();
}

/** Sign a JPEG with c2patool using default dev certificate. */
async function signWithC2pa(jpegBuf: Buffer): Promise<Buffer> {
  const tmpDir = await mkdtemp(join(tmpdir(), "anchr-c2pa-test-"));
  try {
    const inputPath = join(tmpDir, "input.jpg");
    const outputPath = join(tmpDir, "signed.jpg");
    const manifestPath = join(tmpDir, "manifest.json");

    await Bun.write(inputPath, jpegBuf);
    await Bun.write(manifestPath, JSON.stringify({
      claim_generator: "anchr-test/1.0",
      assertions: [
        { label: "c2pa.actions", data: { actions: [{ action: "c2pa.created" }] } },
        {
          label: "stds.schema-org.CreativeWork",
          data: { "@type": "CreativeWork", "author": [{ "@type": "Person", "name": "Anchr Test Worker" }] },
        },
      ],
    }));

    const proc = Bun.spawn(["c2patool", inputPath, "-m", manifestPath, "-o", outputPath, "-f"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`c2patool signing failed: ${stderr}`);
    }

    return Buffer.from(await Bun.file(outputPath).arrayBuffer());
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// Skip all tests if c2patool is not installed
const skip = !isC2paAvailable();

// Shared fixtures — created once, reused across tests
let unsignedJpeg: Buffer;
let signedJpeg: Buffer;

describe("c2pa-validation", () => {
  beforeAll(async () => {
    if (skip) return;
    unsignedJpeg = await createTestJpeg();
    signedJpeg = await signWithC2pa(unsignedJpeg);
  });

  test.skipIf(skip)("validates a C2PA-signed JPEG", async () => {
    const result = await validateC2pa(signedJpeg, "photo.jpg");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(true);
    expect(result.signatureValid).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.manifest!.signatureInfo?.issuer).toBeDefined();
    expect(result.checks).toContain("C2PA manifest found");
    expect(result.checks).toContain("C2PA signature valid");
    expect(result.failures).toHaveLength(0);
  });

  test.skipIf(skip)("detects unsigned JPEG (no manifest)", async () => {
    const result = await validateC2pa(unsignedJpeg, "unsigned.jpg");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(false);
    expect(result.signatureValid).toBe(false);
  });

  test.skipIf(skip)("detects tampered image (data hash mismatch)", async () => {
    const tampered = Buffer.from(signedJpeg);
    for (let i = tampered.length - 50; i < tampered.length - 2; i++) {
      tampered[i] = tampered[i]! ^ 0xff;
    }

    const result = await validateC2pa(tampered, "tampered.jpg");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(true);
    expect(result.signatureValid).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  test.skipIf(skip)("rejects unsupported file format", async () => {
    const result = await validateC2pa(Buffer.from("test"), "doc.pdf");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([expect.stringContaining("unsupported format")]));
  });
});
