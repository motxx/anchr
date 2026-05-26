export class AnchrError extends Error {
  constructor(message: string, public code: string, public details?: unknown) {
    super(message);
    this.name = "AnchrError";
  }
}

export class RequestTimeoutError extends AnchrError {
  constructor(requestId: string, timeoutSeconds: number) {
    super(
      `Request ${requestId} timed out after ${timeoutSeconds}s`,
      "TIMEOUT",
      {
        requestId,
        timeoutSeconds,
      },
    );
  }
}

export class VerificationFailedError extends AnchrError {
  constructor(requestId: string, failures: string[]) {
    super(
      `Verification failed: ${failures.join(", ")}`,
      "VERIFICATION_FAILED",
      { requestId, failures },
    );
  }
}
