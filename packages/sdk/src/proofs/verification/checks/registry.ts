/**
 * Default factor-check registry. Adding a verification factor is one check
 * module plus one entry here; the verifier core never imports a concrete
 * validator.
 */

import { emptySubmissionCheck } from "./empty-submission.ts";
import { bodyGpsCheck } from "./gps.ts";
import { tlsnCheck } from "./tlsn.ts";
import { photoIntegrityCheck } from "./photo-integrity.ts";
import { aiContentCheck } from "./ai-content.ts";
import type { FactorCheck } from "./types.ts";

export const defaultFactorChecks: readonly FactorCheck[] = [
  emptySubmissionCheck,
  bodyGpsCheck,
  tlsnCheck,
  photoIntegrityCheck,
  aiContentCheck,
];
