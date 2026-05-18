/**
 * Shared types for pi-lens
 */

import type { Diagnostic } from "vscode-languageserver-types";

// ═══════════════════════════════════════════════════════════════════════
// Linter types
// ═══════════════════════════════════════════════════════════════════════

/** Normalized lint issue — the universal output format */
export interface LintIssue {
  file: string; // Absolute path
  line: number; // 1-based
  column: number; // 1-based
  endLine?: number; // 1-based, optional
  endColumn?: number; // 1-based, optional
  severity: "error" | "warning" | "info";
  message: string;
  code?: string; // Rule ID (e.g., "no-unused-vars", "E501")
  source?: string; // Linter name (e.g., "eslint", "ruff")
}

/** Static definition of a supported linter */
export interface LinterDefinition {
  /** Unique identifier (e.g., "eslint", "ruff") */
  name: string;
  /** Human-readable label */
  label: string;
  /** Languages this linter handles */
  languages: string[]; // e.g., ["javascript", "typescript"]
  /** File extensions this linter handles (with dot, e.g., [".js", ".ts"]) */
  extensions: string[];
  /** Config files to look for (relative to cwd) */
  configFiles: string[];
  /** Additional detection: check package.json devDependencies keys */
  packageKeys?: string[]; // e.g., ["eslint"]
  /** Project marker files that indicate this language ecosystem */
  projectMarkers?: string[]; // e.g., ["package.json"]
  /** Command to verify the linter is installed */
  versionCommand: string; // e.g., "npx eslint --version"
  /** Command to lint files with JSON output. Returns [cmd, ...args] */
  lintCommand: (files: string[]) => string[];
  /** Parser: raw JSON stdout → LintIssue[] */
  parseOutput: (stdout: string, cwd: string) => LintIssue[];
  /** Timeout for lint command execution (ms) */
  timeout: number;
}

/** A linter detected as available in the current project */
export interface DetectedLinter {
  definition: LinterDefinition;
  /** Resolved config file path (if found) */
  configFile?: string;
  /** Version string from `versionCommand` */
  version?: string;
  /** How this linter was detected */
  detectionSource: "config-file" | "package-key" | "project-marker";
}

// ═══════════════════════════════════════════════════════════════════════
// LSP types
// ═══════════════════════════════════════════════════════════════════════

/** LSP server configuration — describes how to start a language server */
export interface LspServerConfig {
  /** Language name (e.g. "typescript", "python") */
  language: string;
  /** Command to start the LSP server (argv[0]) */
  command: string;
  /** Additional args for the server command */
  args: string[];
  /** File extensions this server handles (with dot, e.g. ".ts") */
  extensions: string[];
  /** Initialization options sent during initialize */
  initializationOptions?: Record<string, unknown>;
  /** How to detect if the server is already installed */
  detectCommand: string;
  /** Human-readable install instructions */
  installInstructions: string;
  /** Package manager command to install the server */
  installCommand: string;
}

/** Server status lifecycle */
export type ServerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

/** Runtime state for a single LSP server instance */
export interface LspServerInstance {
  config: LspServerConfig;
  status: ServerStatus;
  /** Child process PID */
  pid: number | null;
  /** JSON-RPC message ID counter */
  nextId: number;
  /** Pending requests: id → resolve/reject */
  pendingRequests: Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer?: NodeJS.Timeout }
  >;
  /** Last activity timestamp (ms) */
  lastActive: number;
  /** File versions for didChange tracking: uri → version */
  fileVersions: Map<string, number>;
  /** Diagnostics cache: uri → Diagnostic[] */
  diagnostics: Map<string, Diagnostic[]>;
  /** Root URI for this server instance */
  rootUri: string | null;
}

/** Manager state for all LSP servers */
export interface LspManagerState {
  /** Active server instances keyed by language */
  servers: Map<string, LspServerInstance>;
  /** Idle timeout in ms (default 5 min) */
  idleTimeoutMs: number;
  /** Interval timer for checking idle servers */
  idleCheckInterval: NodeJS.Timeout | null;
  /** Current working directory */
  cwd: string;
}

// ═══════════════════════════════════════════════════════════════════════
// pi-lens types (new)
// ═══════════════════════════════════════════════════════════════════════

/** Result of running prettier on a single file */
export interface PrettierResult {
  file: string;
  changed: boolean;
  error?: string;
}

/** Parsed tsc diagnostic */
export interface TscIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
  code?: string;
}

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
