import { test, expect, describe } from "bun:test";
import { validateC2pa, isC2paAvailable } from "./c2pa-validation";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a minimal JPEG buffer. Uses sharp if available, falls back to sips. */
async function createTestJpeg(): Promise<Buffer> {
  const tmpDir = await mkdtemp(join(tmpdir(), "anchr-jpeg-"));
  const outPath = join(tmpDir, "test.jpg");
  try {
    // Try sharp (use variable to prevent TS module resolution)
    const sharpName = "sharp";
    const sharpMod = await import(sharpName).catch(() => null);
    if (sharpMod) {
      const buf = await sharpMod.default({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
      }).jpeg().toBuffer();
      return buf;
    }
    // Fallback: sips (macOS)
    const pngPath = join(tmpDir, "test.png");
    // Create 1x1 white PNG (minimal valid PNG)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    await Bun.write(pngPath, pngHeader);
    const proc = Bun.spawn(["sips", "-s", "format", "jpeg", pngPath, "--out", outPath], {
      stdout: "pipe", stderr: "pipe",
    });
    await proc.exited;
    return Buffer.from(await Bun.file(outPath).arrayBuffer());
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

/** Sign a JPEG with c2patool using default dev certificate. */
async function signWithC2pa(jpegBuf: Buffer, manifest?: Record<string, unknown>): Promise<Buffer> {
  const tmpDir = await mkdtemp(join(tmpdir(), "anchr-c2pa-test-"));
  try {
    const inputPath = join(tmpDir, "input.jpg");
    const outputPath = join(tmpDir, "signed.jpg");
    const manifestPath = join(tmpDir, "manifest.json");

    await Bun.write(inputPath, jpegBuf);
    await Bun.write(manifestPath, JSON.stringify(manifest ?? {
      claim_generator: "anchr-test/1.0",
      assertions: [
        {
          label: "c2pa.actions",
          data: { actions: [{ action: "c2pa.created" }] },
        },
        {
          label: "stds.schema-org.CreativeWork",
          data: {
            "@type": "CreativeWork",
            "author": [{ "@type": "Person", "name": "Anchr Test Worker" }],
          },
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

describe("c2pa-validation", () => {
  test.skipIf(skip)("validates a C2PA-signed JPEG", async () => {
    const jpeg = await createTestJpeg();
    const signed = await signWithC2pa(jpeg);

    const result = await validateC2pa(signed, "photo.jpg");

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
    const jpeg = await createTestJpeg();

    const result = await validateC2pa(jpeg, "unsigned.jpg");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(false);
    expect(result.signatureValid).toBe(false);
  });

  test.skipIf(skip)("detects tampered image (data hash mismatch)", async () => {
    const jpeg = await createTestJpeg();
    const signed = await signWithC2pa(jpeg);

    // Tamper: flip some pixel bytes in the image data (after JUMBF/C2PA header)
    const tampered = Buffer.from(signed);
    // Modify bytes near the end (image data area) to corrupt the data hash
    for (let i = tampered.length - 50; i < tampered.length - 2; i++) {
      tampered[i] = tampered[i]! ^ 0xff;
    }

    const result = await validateC2pa(tampered, "tampered.jpg");

    expect(result.available).toBe(true);
    // Tampered image may still parse but signature should fail
    if (result.hasManifest) {
      expect(result.signatureValid).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    }
  });

  test.skipIf(skip)("rejects unsupported file format", async () => {
    const result = await validateC2pa(Buffer.from("test"), "doc.pdf");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([expect.stringContaining("unsupported format")]));
  });
});
