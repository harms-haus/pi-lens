/**
 * Hook runner — main orchestrator for pi-lens
 *
 * Detects changed files from tool results and sends them to the code-lens
 * daemon for a full check (prettier, linters, LSP diagnostics, tsc).
 *
 * The daemon handles all check execution. This module is responsible for:
 * 1. Resolving affected files from tool results
 * 2. Sending a fullCheck request to the daemon
 * 3. Formatting and returning the results
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { LensConfig, CheckStatus } from "./types.js";
import { detectFilesFromBashCommand } from "./bash-file-detector.js";
import { sendRequest, getSocketPath } from "@harms-haus/code-lens/client";

/** Shared state passed from the extension entry point */
export interface LensState {
  config: LensConfig;
  cwd: string;
}

/** Per-check status trackers for status bar */
export interface HookCheckStatuses {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
}

/** Full result of the hook check pipeline */
export interface HookResult {
  /** Formatted text to append to tool result */
  text: string;
  /** Per-check statuses for status bar */
  statuses: HookCheckStatuses;
  /** Total duration in ms */
  durationMs: number;
}

// ── File Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve file paths from a tool result event.
 *
 * - For `write`/`edit`: extracts `input.path`, resolves to absolute
 * - For `bash`: analyzes the command string for file-writing patterns
 * - Filters to files that actually exist on disk
 * - Deduplicates results
 */
export function resolveFilesFromToolResult(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
  config?: LensConfig,
): string[] {
  let rawPaths: string[];

  switch (toolName) {
    case "write":
    case "edit": {
      const filePath = input.path;
      if (typeof filePath !== "string" || filePath.length === 0) return [];
      rawPaths = [filePath];
      break;
    }

    case "bash": {
      if (config && !config.bashDetection) return [];
      const command = input.command;
      if (typeof command !== "string" || command.length === 0) return [];
      const detected = detectFilesFromBashCommand(command, cwd);
      rawPaths = detected.written;
      break;
    }

    default:
      return [];
  }

  // Resolve to absolute paths
  const absolutePaths = rawPaths.map((p) =>
    path.isAbsolute(p) ? path.normalize(p) : path.normalize(path.resolve(cwd, p)),
  );

  // Filter to paths contained within cwd (prevent path traversal)
  const normalizedCwd = path.resolve(cwd) + path.sep;
  const containedPaths = absolutePaths.filter(
    (p) => p.startsWith(normalizedCwd) || p === path.resolve(cwd),
  );

  // Deduplicate
  const uniquePaths = [...new Set(containedPaths)];

  // Filter to files that exist
  return uniquePaths.filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a clean result message (all checks passed).
 */
export function formatCleanMessage(fileCount: number, durationMs: number): string {
  return `🔍 pi-lens: ${fileCount} file(s) checked — all clean (${durationMs}ms)`;
}

// ── Daemon Communication ────────────────────────────────────────────────────

let requestIdCounter = 0;

/**
 * Run all applicable checks on the given files via the code-lens daemon.
 *
 * Sends a single fullCheck request to the daemon, which runs prettier,
 * linters, LSP diagnostics, and tsc concurrently.
 */
export async function runChecks(
  files: string[],
  cwd: string,
  config: LensConfig,
): Promise<HookResult> {
  const startTime = Date.now();
  const statuses: HookCheckStatuses = {
    prettier: "skipped",
    linters: "skipped",
    lsp: "skipped",
    tsc: "skipped",
  };

  // Filter files by include/exclude patterns
  const filteredFiles = filterFilesByPatterns(
    files,
    cwd,
    config.includePatterns,
    config.excludePatterns,
  );
  if (filteredFiles.length === 0) {
    const durationMs = Date.now() - startTime;
    return { text: "", statuses, durationMs };
  }

  try {
    const socketPath = getSocketPath(cwd);
    const result = await sendRequest(socketPath, {
      jsonrpc: "2.0",
      method: "fullCheck",
      params: {
        files: filteredFiles,
        config: {
          prettier: config.prettier,
          linters: config.linters,
          lsp: config.lsp,
          tsc: config.tsc,
          lspDelayMs: config.lspDelayMs,
          maxConcurrency: config.maxConcurrency,
          prettierTimeoutMs: config.prettierTimeoutMs,
          linterTimeoutMs: config.linterTimeoutMs,
          tscTimeoutMs: config.tscTimeoutMs,
        },
      },
      id: ++requestIdCounter,
    });

    if (result.isError) {
      const durationMs = Date.now() - startTime;
      return { text: "", statuses, durationMs };
    }

    // Extract statuses from daemon response
    const daemonStatuses = result.details.statuses as Record<string, CheckStatus> | undefined;
    if (daemonStatuses) {
      statuses.prettier = daemonStatuses.prettier;
      statuses.linters = daemonStatuses.linters;
      statuses.lsp = daemonStatuses.lsp;
      statuses.tsc = daemonStatuses.tsc;
    }

    const hasIssues = result.details.hasIssues as boolean;
    const sectionsText = result.content[0]?.text ?? "";
    const durationMs = Date.now() - startTime;

    // Build final text
    const text = buildResultText(
      filteredFiles.length,
      durationMs,
      hasIssues,
      config.alwaysReport,
      sectionsText,
    );

    return { text, statuses, durationMs };
  } catch {
    const durationMs = Date.now() - startTime;
    return { text: "", statuses, durationMs };
  }
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/** Build the final result text from check sections */
function buildResultText(
  fileCount: number,
  durationMs: number,
  hasIssues: boolean,
  alwaysReport: boolean,
  sectionsText: string,
): string {
  if (!hasIssues && alwaysReport) {
    return formatCleanMessage(fileCount, durationMs);
  }
  if (hasIssues) {
    const header = `🔍 pi-lens: ${fileCount} file(s) checked (${durationMs}ms)`;
    return `${header}\n${sectionsText}`;
  }
  return "";
}

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports `*` (any non-slash chars) and `**` (any chars including slashes).
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Cache for compiled glob regexes, keyed by the joined patterns string.
 * Patterns don't change during a session, so this avoids re-compiling on every call.
 */
const globRegexCache = new Map<string, RegExp[]>();

/** Get or create cached RegExp array for a set of glob patterns */
function getCachedGlobRegexes(patterns: string[]): RegExp[] {
  const key = patterns.join("\0");
  let cached = globRegexCache.get(key);
  if (!cached) {
    cached = patterns.map(globToRegex);
    globRegexCache.set(key, cached);
  }
  return cached;
}

/**
 * Filter files by include/exclude glob patterns.
 *
 * - If `includePatterns` is non-empty, a file must match at least one.
 * - A file matching any `excludePattern` is always excluded.
 * - Patterns are matched against the relative path from cwd.
 */
export function filterFilesByPatterns(
  files: string[],
  cwd: string,
  includePatterns: string[],
  excludePatterns: string[],
): string[] {
  if (includePatterns.length === 0 && excludePatterns.length === 0) return files;

  const includeRegexes = getCachedGlobRegexes(includePatterns);
  const excludeRegexes = getCachedGlobRegexes(excludePatterns);

  return files.filter((file) => {
    const relativePath = path.relative(cwd, file);

    // If include patterns specified, file must match at least one
    if (includeRegexes.length > 0 && !includeRegexes.some((re) => re.test(relativePath))) {
      return false;
    }

    // Exclude takes precedence
    if (excludeRegexes.some((re) => re.test(relativePath))) {
      return false;
    }

    return true;
  });
}
