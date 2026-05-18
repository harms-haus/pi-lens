/**
 * Hook runner — main orchestrator for pi-lens
 *
 * Detects changed files from tool results and runs checks in order:
 * 1. Prettier (report-only — does NOT write)
 * 2. Linters (run detected linters)
 * 3. LSP diagnostics (with configurable delay)
 * 4. TSC (TypeScript type checking)
 *
 * Results are formatted and returned to be appended to the tool result.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { Diagnostic } from "vscode-languageserver-types";
import type { LensConfig, CheckStatus, DetectedLinter } from "./types.js";
import type { LspManager } from "./lsp-manager.js";
import { detectFilesFromBashCommand } from "./bash-file-detector.js";
import { isPrettierAvailable, runPrettier } from "./prettier-runner.js";
import { isTscAvailable, runTsc } from "./tsc-runner.js";
import { runLinters } from "./linter-runner.js";
import { getLintersForFile } from "./linter-registry.js";
import { formatIssues, summarizeIssues, countSeverities } from "./output-formatter.js";
import { languageFromPath } from "./language-config.js";

/** Shared state passed from the extension entry point */
export interface LensState {
  detectedLinters: DetectedLinter[];
  lspManager: LspManager | null;
  config: LensConfig;
  cwd: string;
  prettierAvailable: boolean;
  tscAvailable: boolean;
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

// ── Individual Check Runners ────────────────────────────────────────────────

/**
 * Run prettier check on the files.
 * Returns formatted section text, updated status, and whether issues were found.
 */
async function runPrettierCheck(
  files: string[],
  cwd: string,
  config: LensConfig,
  prettierAvailable?: boolean,
  signal?: AbortSignal,
): Promise<{ section: string | null; status: CheckStatus; hasIssues: boolean }> {
  if (!config.prettier) return { section: null, status: "skipped", hasIssues: false };

  if (prettierAvailable === false) return { section: null, status: "skipped", hasIssues: false };
  if (prettierAvailable === undefined) {
    const available = await isPrettierAvailable(cwd);
    if (!available) return { section: null, status: "skipped", hasIssues: false };
  }

  try {
    const results = await runPrettier(files, cwd, signal, config.prettierTimeoutMs);
    const needFormatting = results.filter((r) => r.changed);
    const errored = results.filter((r) => r.error);

    if (needFormatting.length > 0) {
      const fileNames = needFormatting.map((r) => path.relative(cwd, r.file) || r.file);
      return {
        section: `  ⚠ prettier: ${needFormatting.length} file(s) need formatting\n    ${fileNames.join("\n    ")}`,
        status: "issues",
        hasIssues: true,
      };
    }

    if (errored.length > 0) {
      return {
        section: `  ⚠ prettier: ${errored.length} file(s) had errors`,
        status: "error",
        hasIssues: false,
      };
    }

    if (results.length > 0) {
      return {
        section: `  ✅ prettier: ${results.length} file(s) formatted`,
        status: "clean",
        hasIssues: false,
      };
    }

    return { section: null, status: "clean", hasIssues: false };
  } catch {
    return { section: "  ⚠ prettier: check failed", status: "error", hasIssues: false };
  }
}

/**
 * Run linter checks on the files.
 */
async function runLinterCheck(
  files: string[],
  cwd: string,
  config: LensConfig,
  state: LensState,
  signal?: AbortSignal,
): Promise<{ section: string | null; status: CheckStatus; hasIssues: boolean }> {
  if (!config.linters || state.detectedLinters.length === 0) {
    return { section: null, status: "skipped", hasIssues: false };
  }

  const relevantLinters = getRelevantLinters(files, state.detectedLinters);
  if (relevantLinters.length === 0) {
    return { section: null, status: "skipped", hasIssues: false };
  }

  try {
    const issues = await runLinters(
      relevantLinters,
      files,
      cwd,
      signal,
      config.maxConcurrency,
      config.linterTimeoutMs,
    );
    if (issues.length > 0) {
      const summary = summarizeIssues(issues);
      const formatted = formatIssues(issues, cwd);
      return {
        section: `  ⚠ ${summary}\n${formatted}`,
        status: "issues",
        hasIssues: true,
      };
    }
    return { section: "  ✅ linters: 0 issues", status: "clean", hasIssues: false };
  } catch {
    return { section: "  ⚠ linters: check failed", status: "error", hasIssues: false };
  }
}

/**
 * Run LSP diagnostic checks on the files.
 */
async function runLspCheck(
  files: string[],
  cwd: string,
  config: LensConfig,
  state: LensState,
  signal?: AbortSignal,
): Promise<{ section: string | null; status: CheckStatus; hasIssues: boolean }> {
  if (!config.lsp || !state.lspManager) {
    return { section: null, status: "skipped", hasIssues: false };
  }

  const filesWithLanguage = files.filter((f) => languageFromPath(f) !== undefined);
  if (filesWithLanguage.length === 0) {
    return { section: null, status: "skipped", hasIssues: false };
  }

  try {
    // Notify LSP about changed files
    for (const file of filesWithLanguage) {
      await state.lspManager.onFileChanged(file);
    }

    // Wait for diagnostics to settle
    await sleep(config.lspDelayMs, signal);

    // Collect diagnostics
    const allDiags: { file: string; diagnostics: Diagnostic[] }[] = [];
    for (const file of filesWithLanguage) {
      const diags = await state.lspManager.getDiagnostics(file, true);
      if (diags.length > 0) {
        allDiags.push({ file, diagnostics: diags });
      }
    }

    if (allDiags.length === 0) {
      return { section: "  ✅ lsp: 0 diagnostics", status: "clean", hasIssues: false };
    }

    const totalDiags = allDiags.reduce((sum, d) => sum + d.diagnostics.length, 0);
    const { errors, warnings } = countSeverities(allDiags.flatMap((d) => d.diagnostics));

    const diagLines = formatDiagnosticSections(allDiags, cwd);
    return {
      section: `  ⚠ lsp: ${totalDiags} diagnostic(s) (${errors} error(s), ${warnings} warning(s))\n${diagLines}`,
      status: "issues",
      hasIssues: true,
    };
  } catch {
    return { section: "  ⚠ lsp: check failed", status: "error", hasIssues: false };
  }
}

/**
 * Run TypeScript type checking on the files.
 */
async function runTscCheck(
  files: string[],
  cwd: string,
  config: LensConfig,
  tscAvailable?: boolean,
  signal?: AbortSignal,
): Promise<{ section: string | null; status: CheckStatus; hasIssues: boolean }> {
  if (!config.tsc) return { section: null, status: "skipped", hasIssues: false };

  if (tscAvailable === false) return { section: null, status: "skipped", hasIssues: false };
  if (tscAvailable === undefined) {
    const available = await isTscAvailable(cwd);
    if (!available) return { section: null, status: "skipped", hasIssues: false };
  }

  const tsFiles = filterToTsFiles(files);
  if (tsFiles.length === 0) return { section: null, status: "skipped", hasIssues: false };

  try {
    const tscResult = await runTsc(cwd, tsFiles, signal, config.tscTimeoutMs);

    if (tscResult.error) {
      return { section: `  ⚠ tsc: ${tscResult.error}`, status: "error", hasIssues: false };
    }

    if (tscResult.issues.length === 0) {
      return { section: "  ✅ tsc: 0 errors", status: "clean", hasIssues: false };
    }

    const errorCount = tscResult.issues.filter((i) => i.severity === "error").length;
    const warningCount = tscResult.issues.filter((i) => i.severity === "warning").length;
    const summary = `${errorCount} error(s), ${warningCount} warning(s)`;
    const issueLines = formatTscIssues(tscResult.issues, cwd);
    return {
      section: `  ⚠ tsc: ${summary}\n${issueLines}`,
      status: "issues",
      hasIssues: true,
    };
  } catch {
    return { section: "  ⚠ tsc: check failed", status: "error", hasIssues: false };
  }
}

// ── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Run all applicable checks on the given files and return formatted results.
 *
 * All checks run concurrently via Promise.all for maximum throughput.
 * Each check is gated by its config flag and availability.
 */
export async function runChecks(
  files: string[],
  cwd: string,
  config: LensConfig,
  state: LensState,
  signal?: AbortSignal,
): Promise<HookResult> {
  const startTime = Date.now();
  const statuses: HookCheckStatuses = {
    prettier: "skipped",
    linters: "skipped",
    lsp: "skipped",
    tsc: "skipped",
  };

  const sections: string[] = [];
  let hasIssues = false;

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

  // Run all checks concurrently — prettier, linters, LSP, and tsc are independent.
  // LSP includes a configurable delay, so overlapping it hides that latency.
  const [prettier, linter, lsp, tsc] = await Promise.all([
    runPrettierCheck(filteredFiles, cwd, config, state.prettierAvailable, signal),
    runLinterCheck(filteredFiles, cwd, config, state, signal),
    runLspCheck(filteredFiles, cwd, config, state, signal),
    runTscCheck(filteredFiles, cwd, config, state.tscAvailable, signal),
  ]);

  statuses.prettier = prettier.status;
  if (prettier.section) sections.push(prettier.section);
  if (prettier.hasIssues) hasIssues = true;

  statuses.linters = linter.status;
  if (linter.section) sections.push(linter.section);
  if (linter.hasIssues) hasIssues = true;

  statuses.lsp = lsp.status;
  if (lsp.section) sections.push(lsp.section);
  if (lsp.hasIssues) hasIssues = true;

  statuses.tsc = tsc.status;
  if (tsc.section) sections.push(tsc.section);
  if (tsc.hasIssues) hasIssues = true;

  const durationMs = Date.now() - startTime;

  // Build final text
  const text = buildResultText(
    filteredFiles.length,
    durationMs,
    hasIssues,
    config.alwaysReport,
    sections,
  );

  return { text, statuses, durationMs };
}

// ── Internal Helpers ────────────────────────────────────────────────────────

/** Build the final result text from check sections */
function buildResultText(
  fileCount: number,
  durationMs: number,
  hasIssues: boolean,
  alwaysReport: boolean,
  sections: string[],
): string {
  if (!hasIssues && alwaysReport) {
    return formatCleanMessage(fileCount, durationMs);
  }
  if (hasIssues) {
    const header = `🔍 pi-lens: ${fileCount} file(s) checked (${durationMs}ms)`;
    return `${header}\n${sections.join("\n")}`;
  }
  return "";
}

/** Get all linters that are relevant for at least one of the given files */
function getRelevantLinters(files: string[], detected: DetectedLinter[]): DetectedLinter[] {
  const relevant = new Set<string>();
  const result: DetectedLinter[] = [];
  for (const file of files) {
    for (const linter of getLintersForFile(file, detected)) {
      if (!relevant.has(linter.definition.name)) {
        relevant.add(linter.definition.name);
        result.push(linter);
      }
    }
  }
  return result;
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

/** Filter files to TypeScript/JavaScript extensions */
function filterToTsFiles(files: string[]): string[] {
  const tsExts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
  return files.filter((f) => tsExts.has(path.extname(f).toLowerCase()));
}

/** Sleep for a given duration, abortable via signal */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Format LSP diagnostic sections for output */
function formatDiagnosticSections(
  allDiags: { file: string; diagnostics: Diagnostic[] }[],
  cwd: string,
): string {
  return allDiags
    .map(({ file, diagnostics }) => {
      const relativePath = path.relative(cwd, file) || file;
      return diagnostics
        .slice(0, 20)
        .map((d) => {
          const icon = d.severity === 1 ? "✗" : d.severity === 2 ? "⚠" : "ℹ";
          const line = d.range.start.line + 1;
          const col = d.range.start.character + 1;
          const msg = d.message.split("\n")[0];
          return `    ${icon} ${relativePath}:${line}:${col}: ${msg}`;
        })
        .join("\n");
    })
    .join("\n");
}

/** Format TSC issues for output */
function formatTscIssues(
  issues: {
    file: string;
    line: number;
    column: number;
    severity: string;
    message: string;
    code?: string;
  }[],
  cwd: string,
): string {
  return issues
    .slice(0, 50)
    .map((i) => {
      const icon = i.severity === "error" ? "✗" : "⚠";
      const relativePath = path.relative(cwd, i.file) || i.file;
      return `    ${icon} ${relativePath}:${i.line}:${i.column}: ${i.message} (${i.code ?? "TS"})`;
    })
    .join("\n");
}
