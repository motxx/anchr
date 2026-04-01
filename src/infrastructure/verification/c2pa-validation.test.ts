import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { validateC2pa, isC2paAvailable } from "./c2pa-validation.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, writeFile, fileExists, readFileAsArrayBuffer } from "../../runtime/mod.ts";

/**
 * Build a minimal valid JPEG from raw bytes (no external dependencies).
 * SOI + APP0(JFIF) + DQT + SOF0(1x1) + DHT + SOS + EOI
 */
function buildMinimalJpeg(): Buffer {
  const parts: Buffer[] = [];

  // SOI
  parts.push(Buffer.from([0xff, 0xd8]));

  // APP0 JFIF
  const jfif = Buffer.from("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00", "binary");
  const app0Len = Buffer.alloc(2);
  app0Len.writeUInt16BE(jfif.length + 2);
  parts.push(Buffer.from([0xff, 0xe0]), app0Len, jfif);

  // DQT (64-byte quantization table)
  const qt = Buffer.alloc(64, 1);
  const dqtLen = Buffer.alloc(2);
  dqtLen.writeUInt16BE(qt.length + 3);
  parts.push(Buffer.from([0xff, 0xdb]), dqtLen, Buffer.from([0x00]), qt);

  // SOF0: 1x1, 1 component, 8-bit
  parts.push(Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]));

  // DHT (minimal DC Huffman table)
  const ht = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(16), Buffer.from([0x00])]);
  const dhtLen = Buffer.alloc(2);
  dhtLen.writeUInt16BE(ht.length + 2);
  parts.push(Buffer.from([0xff, 0xc4]), dhtLen, ht);

  // SOS + scan data
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0x50]));

  // EOI
  parts.push(Buffer.from([0xff, 0xd9]));

  return Buffer.concat(parts);
}

/** Sign a JPEG with c2patool using default dev certificate. */
async function signWithC2pa(jpegBuf: Buffer): Promise<Buffer> {
  const tmpDir = await mkdtemp(join(tmpdir(), "anchr-c2pa-test-"));
  try {
    const inputPath = join(tmpDir, "input.jpg");
    const outputPath = join(tmpDir, "signed.jpg");
    const manifestPath = join(tmpDir, "manifest.json");

    await writeFile(inputPath, jpegBuf);
    await writeFile(manifestPath, JSON.stringify({
      claim_generator: "anchr-test/1.0",
      assertions: [
        { label: "c2pa.actions", data: { actions: [{ action: "c2pa.created" }] } },
        {
          label: "stds.schema-org.CreativeWork",
          data: { "@type": "CreativeWork", "author": [{ "@type": "Person", "name": "Anchr Test Worker" }] },
        },
      ],
    }));

    const proc = spawn(["c2patool", inputPath, "-m", manifestPath, "-o", outputPath, "-f"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`c2patool signing failed: ${stderr}`);
    }

    return Buffer.from(await readFileAsArrayBuffer(outputPath));
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
    unsignedJpeg = buildMinimalJpeg();
    signedJpeg = await signWithC2pa(unsignedJpeg);
  });

  test("validates a C2PA-signed JPEG", async () => {
    if (skip) return;
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

  test("detects unsigned JPEG (no manifest)", async () => {
    if (skip) return;
    const result = await validateC2pa(unsignedJpeg, "unsigned.jpg");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(false);
    expect(result.signatureValid).toBe(false);
  });

  test("detects tampered image", async () => {
    if (skip) return;
    const tampered = Buffer.from(signedJpeg);
    for (let i = tampered.length - 50; i < tampered.length - 2; i++) {
      tampered[i] = tampered[i]! ^ 0xff;
    }

    const result = await validateC2pa(tampered, "tampered.jpg");

    expect(result.available).toBe(true);
    // Tampering either corrupts the manifest (hasManifest=false) or
    // preserves it but invalidates the data hash (signatureValid=false).
    // Either way, signatureValid must be false.
    expect(result.signatureValid).toBe(false);
  });

  test("rejects unsupported file format", async () => {
    if (skip) return;
    const result = await validateC2pa(Buffer.from("test"), "doc.pdf");

    expect(result.available).toBe(true);
    expect(result.hasManifest).toBe(false);
    expect(result.checks).toEqual(expect.arrayContaining([expect.stringContaining("unsupported format")]));
  });
});
