export {
  type C2paValidationResult as ContentCredentialsValidationResult,
  validateC2pa as validateContentCredentials,
} from "./c2pa-validation.ts";
import type { ExifValidationResult } from "./exif-validation.ts";
import { storeIntegrity } from "./integrity-store.ts";
import type { ProofModeIntegrity } from "./integrity-store.ts";
import type { C2paValidationResult } from "./c2pa-validation.ts";

export interface StoreContentCredentialsIntegrityOptions {
  attachmentId: string;
  requestId: string;
  capturedAt: number;
  exif: ExifValidationResult;
  provenance: C2paValidationResult;
  proofmode?: ProofModeIntegrity;
}

export function storeContentCredentialsIntegrity(
  options: StoreContentCredentialsIntegrityOptions,
): void {
  storeIntegrity({
    attachmentId: options.attachmentId,
    requestId: options.requestId,
    capturedAt: options.capturedAt,
    exif: options.exif,
    c2pa: options.provenance,
    proofmode: options.proofmode,
  });
}
