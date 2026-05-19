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
export type CheckStatus = "pending" | "running" | "clean" | "issues" | "error" | "skipped";

/** Unified status bar payload */
export interface LensStatusPayload {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
}
