/**
 * Airdrop Bot Shield — Criteria Definition & Validation
 *
 * Types and helpers for defining airdrop eligibility criteria that claimants
 * must prove via TLSNotary attestations. Each condition maps to a specific
 * API endpoint and JSONPath expression that the oracle evaluates against the
 * cryptographically verified response body.
 *
 * Reference types:
 *   - TlsnRequirement, TlsnCondition from ../../../src/domain/types
 *   - validateTlsn, evaluateCondition from ../../../src/infrastructure/verification/tlsn-validation
 */

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/**
 * Proof condition types that can be verified via TLSNotary.
 *
 * Each type corresponds to a specific API endpoint pattern and extraction logic:
 *   - github_account_age: GitHub API /users/{user} → created_at field
 *   - twitter_followers: Twitter API /2/users/{id} → public_metrics.followers_count
 *   - github_repos: GitHub API /users/{user} → public_repos field
 *   - github_contributions: GitHub API /users/{user} → public_gists + events heuristic
 */
export type ProofConditionType =
  | "github_account_age"
  | "twitter_followers"
  | "github_repos"
  | "github_contributions";

/**
 * A single proof condition that a claimant must satisfy.
 *
 * Each condition generates one TLSNotary proof request. The oracle verifies:
 *   1. TLS signature is valid (domain = target_url hostname)
 *   2. Response body is valid JSON
 *   3. jsonpath extracts a value meeting min_value threshold
 */
export interface ProofCondition {
  /** The type of proof required. */
  type: ProofConditionType;
  /** The URL to TLSNotary-prove (claimant substitutes their username/ID). */
  target_url: string;
  /** Minimum numeric value the extracted field must meet. */
  min_value?: number;
  /** Dot-notation path in the JSON response to extract the value. */
  jsonpath: string;
  /** Human-readable description of what this condition proves. */
  description: string;
}

/**
 * Full airdrop campaign definition.
 *
 * A project creates this to specify who is eligible and how much they receive.
 * The total_budget_sats is pre-locked in a Cashu HTLC escrow pool, with each
 * claim generating a unique hash/preimage pair for atomic settlement.
 */
export interface AirdropCriteria {
  /** Unique identifier for this airdrop campaign. */
  id: string;
  /** Human-readable campaign name. */
  name: string;
  /** List of conditions a claimant must satisfy (all must pass). */
  conditions: ProofCondition[];
  /** Number of sats each successful claimant receives. */
  token_amount_per_claim: number;
  /** Total sats budget for the campaign (locked in Cashu HTLC escrow). */
  total_budget_sats: number;
  /** Cashu token representing the escrowed funds (set after escrow creation). */
  escrow_token?: string;
}

// ---------------------------------------------------------------------------
// GitHub API Response Shapes (for documentation and mock generation)
// ---------------------------------------------------------------------------

/**
 * Subset of the GitHub REST API /users/{username} response.
 * See: https://docs.github.com/en/rest/users/users#get-a-user
 */
export interface GitHubUserResponse {
  login: string;
  id: number;
  created_at: string; // ISO 8601, e.g. "2015-03-14T09:26:53Z"
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
}

/**
 * Subset of the Twitter API v2 /users/{id} response with user.fields=public_metrics.
 * See: https://developer.x.com/en/docs/twitter-api/users/lookup/api-reference/get-users-id
 */
export interface TwitterUserResponse {
  data: {
    id: string;
    name: string;
    username: string;
    public_metrics: {
      followers_count: number;
      following_count: number;
      tweet_count: number;
      listed_count: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Condition Builders
// ---------------------------------------------------------------------------

/**
 * Build a condition requiring a GitHub account older than `minDaysOld` days.
 *
 * Verifies against: GET https://api.github.com/users/{username}
 * Extracts: `created_at` field (ISO 8601 timestamp)
 * The oracle computes (now - created_at) in days and checks >= minDaysOld.
 *
 * Example API response:
 *   {
 *     "login": "octocat",
 *     "created_at": "2011-01-25T18:44:36Z",
 *     "public_repos": 8,
 *     ...
 *   }
 */
export function buildGitHubAgeCondition(minDaysOld: number): ProofCondition {
  if (minDaysOld <= 0) {
    throw new Error(`minDaysOld must be positive, got ${minDaysOld}`);
  }
  return {
    type: "github_account_age",
    target_url: "https://api.github.com/users/{username}",
    min_value: minDaysOld,
    jsonpath: "created_at",
    description: `GitHub account older than ${minDaysOld} days`,
  };
}

/**
 * Build a condition requiring at least `minFollowers` Twitter followers.
 *
 * Verifies against: GET https://api.x.com/2/users/{id}?user.fields=public_metrics
 * Extracts: `data.public_metrics.followers_count`
 *
 * Example API response:
 *   {
 *     "data": {
 *       "id": "12345",
 *       "name": "Example User",
 *       "username": "example",
 *       "public_metrics": {
 *         "followers_count": 1500,
 *         "following_count": 300,
 *         "tweet_count": 5000,
 *         "listed_count": 42
 *       }
 *     }
 *   }
 */
export function buildTwitterFollowerCondition(minFollowers: number): ProofCondition {
  if (minFollowers <= 0) {
    throw new Error(`minFollowers must be positive, got ${minFollowers}`);
  }
  return {
    type: "twitter_followers",
    target_url: "https://api.x.com/2/users/{id}?user.fields=public_metrics",
    min_value: minFollowers,
    jsonpath: "data.public_metrics.followers_count",
    description: `Twitter account with ${minFollowers}+ followers`,
  };
}

/**
 * Build a condition requiring at least `minRepos` public GitHub repositories.
 *
 * Verifies against: GET https://api.github.com/users/{username}
 * Extracts: `public_repos` field (integer)
 */
export function buildGitHubReposCondition(minRepos: number): ProofCondition {
  if (minRepos <= 0) {
    throw new Error(`minRepos must be positive, got ${minRepos}`);
  }
  return {
    type: "github_repos",
    target_url: "https://api.github.com/users/{username}",
    min_value: minRepos,
    jsonpath: "public_repos",
    description: `At least ${minRepos} public GitHub repositories`,
  };
}

/**
 * Build a condition requiring at least `minContributions` GitHub contributions.
 *
 * Uses `public_gists` as a proxy for contribution activity from the user endpoint.
 * In production, this could be enhanced by proving the GitHub contributions calendar
 * page or the events API, but the user endpoint provides a baseline.
 *
 * Verifies against: GET https://api.github.com/users/{username}
 * Extracts: `public_gists` field (integer, proxy for contribution activity)
 */
export function buildGitHubContributionCondition(minContributions: number): ProofCondition {
  if (minContributions <= 0) {
    throw new Error(`minContributions must be positive, got ${minContributions}`);
  }
  return {
    type: "github_contributions",
    target_url: "https://api.github.com/users/{username}",
    min_value: minContributions,
    jsonpath: "public_gists",
    description: `At least ${minContributions} GitHub contributions (public gists as proxy)`,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate an AirdropCriteria structure.
 *
 * Checks:
 *   - Required fields are present and non-empty
 *   - At least one condition is defined
 *   - Each condition has valid type, target_url, and jsonpath
 *   - Budget is sufficient for at least one claim
 *   - Numeric values are positive
 *
 * Returns an array of validation errors (empty = valid).
 */
export function validateCriteria(criteria: AirdropCriteria): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!criteria.id || criteria.id.trim() === "") {
    errors.push({ field: "id", message: "Airdrop ID is required" });
  }

  if (!criteria.name || criteria.name.trim() === "") {
    errors.push({ field: "name", message: "Airdrop name is required" });
  }

  if (!criteria.conditions || criteria.conditions.length === 0) {
    errors.push({ field: "conditions", message: "At least one proof condition is required" });
  } else {
    const validTypes: ProofConditionType[] = [
      "github_account_age",
      "twitter_followers",
      "github_repos",
      "github_contributions",
    ];

    for (let i = 0; i < criteria.conditions.length; i++) {
      const cond = criteria.conditions[i]!;

      if (!validTypes.includes(cond.type)) {
        errors.push({
          field: `conditions[${i}].type`,
          message: `Invalid condition type: "${cond.type}". Must be one of: ${validTypes.join(", ")}`,
        });
      }

      if (!cond.target_url || cond.target_url.trim() === "") {
        errors.push({
          field: `conditions[${i}].target_url`,
          message: "target_url is required",
        });
      } else {
        try {
          // Validate URL structure (template vars like {username} will fail, so allow them)
          const testUrl = cond.target_url.replace(/\{[^}]+\}/g, "placeholder");
          new URL(testUrl);
        } catch {
          errors.push({
            field: `conditions[${i}].target_url`,
            message: `Invalid URL format: "${cond.target_url}"`,
          });
        }
      }

      if (!cond.jsonpath || cond.jsonpath.trim() === "") {
        errors.push({
          field: `conditions[${i}].jsonpath`,
          message: "jsonpath is required",
        });
      }

      if (cond.min_value !== undefined && cond.min_value <= 0) {
        errors.push({
          field: `conditions[${i}].min_value`,
          message: `min_value must be positive, got ${cond.min_value}`,
        });
      }

      if (!cond.description || cond.description.trim() === "") {
        errors.push({
          field: `conditions[${i}].description`,
          message: "description is required",
        });
      }
    }
  }

  if (criteria.token_amount_per_claim <= 0) {
    errors.push({
      field: "token_amount_per_claim",
      message: `Must be positive, got ${criteria.token_amount_per_claim}`,
    });
  }

  if (criteria.total_budget_sats <= 0) {
    errors.push({
      field: "total_budget_sats",
      message: `Must be positive, got ${criteria.total_budget_sats}`,
    });
  }

  if (
    criteria.token_amount_per_claim > 0 &&
    criteria.total_budget_sats > 0 &&
    criteria.total_budget_sats < criteria.token_amount_per_claim
  ) {
    errors.push({
      field: "total_budget_sats",
      message: `Budget (${criteria.total_budget_sats} sats) is less than a single claim (${criteria.token_amount_per_claim} sats)`,
    });
  }

  return errors;
}

/**
 * Calculate how many claims a budget can support.
 */
export function maxClaims(criteria: AirdropCriteria): number {
  if (criteria.token_amount_per_claim <= 0) return 0;
  return Math.floor(criteria.total_budget_sats / criteria.token_amount_per_claim);
}

/**
 * Convert criteria conditions to Anchr TlsnRequirement format.
 *
 * This maps our high-level ProofConditions to the lower-level TlsnRequirement
 * and TlsnCondition types used by the Anchr oracle.
 *
 * Reference: TlsnRequirement from ../../../src/domain/types
 */
export function toTlsnRequirements(conditions: ProofCondition[]): Array<{
  target_url: string;
  method: "GET";
  domain_hint: string;
  max_attestation_age_seconds: number;
  conditions: Array<{
    type: "jsonpath";
    expression: string;
    description: string;
  }>;
}> {
  return conditions.map((cond) => {
    const hostname = new URL(cond.target_url.replace(/\{[^}]+\}/g, "placeholder")).hostname;
    return {
      target_url: cond.target_url,
      method: "GET" as const,
      domain_hint: hostname,
      max_attestation_age_seconds: 600,
      conditions: [
        {
          type: "jsonpath" as const,
          expression: cond.jsonpath,
          description: cond.description,
        },
      ],
    };
  });
}
