export class CashuMintError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CashuMintError";
  }
}

export class CashuMintUncertainError extends CashuMintError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "CashuMintUncertainError";
  }
}

export class CashuClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashuClientError";
  }
}
