import Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStoredAttachmentBuffer } from "../attachments";
import { getRuntimeConfig } from "../config";
import type { AttachmentRef, BlossomKeyMap, Query, QueryResult } from "../types";

export interface ContentCheckResult {
  passed: boolean;
  reason: string;
}

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function isImageMime(mime: string): mime is ImageMediaType {
  return IMAGE_MIME_TYPES.has(mime);
}

function isVideoMime(mime: string): boolean {
  return VIDEO_MIME_TYPES.has(mime);
}

function getClient(): Anthropic | null {
  const config = getRuntimeConfig();
  // AI content check must be explicitly opted in (AI_CONTENT_CHECK=true)
  // to avoid sending user photos to third-party APIs without consent
  if (!config.aiContentCheckEnabled) return null;
  if (!config.anthropicApiKey) return null;
  return new Anthropic({ apiKey: config.anthropicApiKey });
}

async function extractVideoFrames(
  videoBuffer: Buffer,
  inputExt: string,
  maxFrames = 3,
): Promise<{ data: Buffer; mimeType: ImageMediaType }[]> {
  const ffmpeg = Bun.which("ffmpeg");
  if (!ffmpeg) return [];

  const tempDir = await mkdtemp(join(tmpdir(), "anchr-frames-"));
  const inputPath = join(tempDir, `input${inputExt}`);
  const outputPattern = join(tempDir, "frame_%03d.jpg");

  try {
    await Bun.write(inputPath, videoBuffer);

    const proc = Bun.spawn(
      [ffmpeg, "-i", inputPath, "-vf", "fps=1", "-frames:v", String(maxFrames), "-q:v", "2", outputPattern],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;
    if (proc.exitCode !== 0) return [];

    const frames: { data: Buffer; mimeType: ImageMediaType }[] = [];
    for (let i = 1; i <= maxFrames; i++) {
      const framePath = join(tempDir, `frame_${String(i).padStart(3, "0")}.jpg`);
      const file = Bun.file(framePath);
      if (await file.exists()) {
        frames.push({
          data: Buffer.from(await file.arrayBuffer()),
          mimeType: "image/jpeg",
        });
      }
    }
    return frames;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function buildPrompt(query: Query): string {
  const nonce = query.challenge_nonce;
  if (nonce) {
    return [
      `You are verifying a photo/video submission for the following query:`,
      `"${query.description}"`,
      ``,
      `Check TWO things:`,
      `1. Does the image show content relevant to this query?`,
      `2. Is the handwritten text "${nonce}" clearly visible on a piece of paper in the image?`,
      ``,
      `Both must be true to pass. Answer in the following JSON format only:`,
      `{"relevant": true or false, "nonce_visible": true or false, "reason": "brief explanation in the language of the query description"}`,
    ].join("\n");
  }
  return [
    `You are verifying a photo/video submission for the following query:`,
    `"${query.description}"`,
    ``,
    `Check whether the image shows content relevant to this query.`,
    ``,
    `Answer in the following JSON format only:`,
    `{"relevant": true or false, "reason": "brief explanation in the language of the query description"}`,
  ].join("\n");
}

async function loadImageContent(
  attachments: AttachmentRef[],
  blossomKeys?: BlossomKeyMap,
): Promise<{ data: string; mimeType: ImageMediaType }[]> {
  const images: { data: string; mimeType: ImageMediaType }[] = [];

  for (const ref of attachments) {
    const mime = ref.mime_type?.toLowerCase() ?? "";
    const keyMaterial = blossomKeys?.[ref.id];

    if (isImageMime(mime)) {
      const buf = await readStoredAttachmentBuffer(ref, undefined, keyMaterial);
      if (buf) {
        images.push({ data: buf.data.toString("base64"), mimeType: mime });
      }
    } else if (isVideoMime(mime)) {
      const buf = await readStoredAttachmentBuffer(ref, undefined, keyMaterial);
      if (buf) {
        const ext = ref.filename?.match(/\.[^.]+$/)?.[0] ?? ".mp4";
        const frames = await extractVideoFrames(buf.data, ext);
        for (const frame of frames) {
          images.push({ data: frame.data.toString("base64"), mimeType: frame.mimeType });
        }
      }
    }
  }

  return images;
}

export async function checkAttachmentContent(
  query: Query,
  result: QueryResult,
  blossomKeys?: BlossomKeyMap,
): Promise<ContentCheckResult | null> {
  const client = getClient();
  if (!client) return null;

  const attachments = result.attachments;
  if (!attachments?.length) return null;

  const images = await loadImageContent(attachments, blossomKeys);
  if (images.length === 0) return null;

  const prompt = buildPrompt(query);
  const content: Anthropic.MessageCreateParams["messages"][0]["content"] = images.map((img) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: img.mimeType, data: img.data },
  }));
  content.push({ type: "text" as const, text: prompt });

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      messages: [{ role: "user", content }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      return { passed: true, reason: "AI response could not be parsed; skipping check" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as { relevant: boolean; nonce_visible?: boolean; reason: string };
    const nonceRequired = query.verification_requirements.includes("nonce");
    const passed = Boolean(parsed.relevant) && (!nonceRequired || Boolean(parsed.nonce_visible));
    return {
      passed,
      reason: parsed.reason || (passed ? "Content matches query" : "Content check failed"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ai-content-check] API error, skipping:", message);
    return null;
  }
}
