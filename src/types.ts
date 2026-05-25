/**
 * Shared types for pi-lens
 */

/** pi-lens configuration (see src/config.ts for defaults) */
export interface LensConfig {
  /** Enable/disable individual checks */
  prettier: boolean;
  linters: boolean;
  lsp: boolean;
  tsc: boolean;

  /** Custom file patterns to include/exclude */
  includePatterns: string[];
  excludePatterns: string[];

  /** Timing configuration */
  lspDelayMs: number;
  maxConcurrency: number;

  /** Timeout for individual checks (ms) */
  prettierTimeoutMs: number;
  linterTimeoutMs: number;
  tscTimeoutMs: number;

  /** Bash file detection */
  bashDetection: boolean;

  /** Report status even when all clean */
  alwaysReport: boolean;
}

/** Status of a check */
export const CHECK_STATUSES = ["pending", "running", "clean", "issues", "error", "skipped"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const VALID_CHECK_STATUSES: Set<CheckStatus> = new Set(CHECK_STATUSES);

export const CHECK_KEYS = ["prettier", "linters", "lsp", "tsc"] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];
export type CheckStatuses = { [K in CheckKey]: CheckStatus };

/** Unified status bar payload */
export interface LensStatusPayload {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
}
