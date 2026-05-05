export class AnchrError extends Error {
  constructor(message: string, public code: string, public details?: unknown) {
    super(message);
    this.name = "AnchrError";
  }
}

export class QueryTimeoutError extends AnchrError {
  constructor(queryId: string, timeoutSeconds: number) {
    super(`Query ${queryId} timed out after ${timeoutSeconds}s`, "TIMEOUT", { queryId, timeoutSeconds });
  }
}

export class VerificationFailedError extends AnchrError {
  constructor(queryId: string, failures: string[]) {
    super(`Verification failed: ${failures.join(", ")}`, "VERIFICATION_FAILED", { queryId, failures });
  }
}
