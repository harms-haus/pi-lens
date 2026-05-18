/**
 * Configuration loading for pi-lens
 *
 * Reads `.pi-lens.json` from the project root and merges with defaults.
 * Handles missing files, malformed JSON, and unknown keys gracefully.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { LensConfig } from "./types.js";

/** Default configuration values */
export const DEFAULT_CONFIG: LensConfig = {
  // Enable/disable individual checks
  prettier: true,
  linters: true,
  lsp: true,
  tsc: true,

  // Custom file patterns to include/exclude
  includePatterns: [],
  excludePatterns: ["node_modules/**", ".git/**", "dist/**", "build/**"],

  // Timing configuration
  lspDelayMs: 1000,
  maxConcurrency: 4,

  // Timeout for individual checks (ms)
  prettierTimeoutMs: 15_000,
  linterTimeoutMs: 15_000,
  tscTimeoutMs: 30_000,

  // Bash file detection
  bashDetection: true,

  // Report status even when all clean
  alwaysReport: true,
};

/** Config file name to look for in the project root */
const CONFIG_FILE_NAME = ".pi-lens.json";

/**
 * Type-safe merge of a partial config into the defaults.
 * Only known keys with correct types are applied; others are silently ignored.
 */
function mergeConfig(partial: Record<string, unknown>): LensConfig {
  const result = { ...DEFAULT_CONFIG };

  // Boolean fields
  for (const key of [
    "prettier",
    "linters",
    "lsp",
    "tsc",
    "bashDetection",
    "alwaysReport",
  ] as const) {
    if (key in partial && typeof partial[key] === "boolean") {
      (result as Record<string, unknown>)[key] = partial[key];
    }
  }

  // Number fields
  for (const key of [
    "lspDelayMs",
    "maxConcurrency",
    "prettierTimeoutMs",
    "linterTimeoutMs",
    "tscTimeoutMs",
  ] as const) {
    if (key in partial && typeof partial[key] === "number" && Number.isFinite(partial[key])) {
      (result as Record<string, unknown>)[key] = partial[key];
    }
  }

  // String array fields
  for (const key of ["includePatterns", "excludePatterns"] as const) {
    if (key in partial && Array.isArray(partial[key])) {
      const arr = partial[key];
      if (arr.every((v: unknown) => typeof v === "string")) {
        (result as Record<string, unknown>)[key] = arr;
      }
    }
  }

  return result;
}

/**
 * Load `.pi-lens.json` from cwd, merging with defaults.
 *
 * - If the file doesn't exist, returns DEFAULT_CONFIG.
 * - If the file contains malformed JSON, warns to stderr and returns DEFAULT_CONFIG.
 * - Unknown keys and wrong-typed values are silently ignored.
 */
export function loadConfig(cwd: string): LensConfig {
  const configPath = path.join(cwd, CONFIG_FILE_NAME);

  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch {
    // File doesn't exist or is unreadable — use defaults
    return { ...DEFAULT_CONFIG };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    // Malformed JSON — warn and use defaults
    console.warn(`pi-lens: failed to parse ${CONFIG_FILE_NAME}: ${String(err)}`);
    return { ...DEFAULT_CONFIG };
  }

  // Validate that the parsed value is a non-null object
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn(`pi-lens: ${CONFIG_FILE_NAME} must be a JSON object, using defaults`);
    return { ...DEFAULT_CONFIG };
  }

  return mergeConfig(parsed as Record<string, unknown>);
}
