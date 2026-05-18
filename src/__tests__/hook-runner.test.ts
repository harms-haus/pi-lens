import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";

// Mock node:fs for resolveFilesFromToolResult (existsSync check)
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock internal modules
vi.mock("../bash-file-detector.js", () => ({
  detectFilesFromBashCommand: vi.fn(),
}));

vi.mock("../prettier-runner.js", () => ({
  isPrettierAvailable: vi.fn(),
  runPrettier: vi.fn(),
}));

vi.mock("../tsc-runner.js", () => ({
  isTscAvailable: vi.fn(),
  runTsc: vi.fn(),
}));

vi.mock("../linter-runner.js", () => ({
  runLinters: vi.fn(),
}));

vi.mock("../linter-registry.js", () => ({
  getLintersForFile: vi.fn(),
}));

vi.mock("../output-formatter.js", () => ({
  formatIssues: vi.fn(),
  summarizeIssues: vi.fn(),
  countSeverities: vi.fn(),
}));

vi.mock("../language-config.js", () => ({
  languageFromPath: vi.fn(),
}));

vi.mock("../lsp-manager.js", () => ({
  LspManager: vi.fn(),
  DEFAULT_IDLE_TIMEOUT_MS: 300_000,
}));

import { resolveFilesFromToolResult, runChecks, formatCleanMessage } from "../hook-runner.js";
import type { LensState } from "../hook-runner.js";
import type { LensConfig, DetectedLinter } from "../types.js";
import { detectFilesFromBashCommand } from "../bash-file-detector.js";
import { isPrettierAvailable, runPrettier } from "../prettier-runner.js";
import { isTscAvailable, runTsc } from "../tsc-runner.js";
import { runLinters } from "../linter-runner.js";
import { languageFromPath } from "../language-config.js";

const CWD = "/home/user/project";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── resolveFilesFromToolResult ───────────────────────────────────────

describe("resolveFilesFromToolResult", () => {
  it("resolves write tool with absolute path", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult(
      "write",
      { path: "/home/user/project/src/foo.ts" },
      CWD,
    );
    expect(result).toEqual(["/home/user/project/src/foo.ts"]);
  });

  it("resolves write tool with relative path against cwd", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult("write", { path: "src/foo.ts" }, CWD);
    expect(result).toEqual([path.normalize(path.resolve(CWD, "src/foo.ts"))]);
  });

  it("resolves edit tool with path", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult(
      "edit",
      { path: "/home/user/project/src/bar.ts" },
      CWD,
    );
    expect(result).toEqual(["/home/user/project/src/bar.ts"]);
  });

  it("resolves bash tool via detectFilesFromBashCommand", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(detectFilesFromBashCommand).mockReturnValue({
      written: [path.resolve(CWD, "modified.txt")],
      read: [],
    });

    const result = resolveFilesFromToolResult(
      "bash",
      { command: "sed -i 's/a/b/g' modified.txt" },
      CWD,
    );
    expect(result).toEqual([path.resolve(CWD, "modified.txt")]);
  });

  it("returns empty array for bash tool with no file operations", () => {
    vi.mocked(detectFilesFromBashCommand).mockReturnValue({
      written: [],
      read: [],
    });

    const result = resolveFilesFromToolResult("bash", { command: "ls -la" }, CWD);
    expect(result).toEqual([]);
  });

  it("returns empty array for unknown tool", () => {
    const result = resolveFilesFromToolResult("read", { path: "/some/file" }, CWD);
    expect(result).toEqual([]);
  });

  it("returns empty array for write tool with missing path", () => {
    const result = resolveFilesFromToolResult("write", {}, CWD);
    expect(result).toEqual([]);
  });

  it("filters to files that exist on disk", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(detectFilesFromBashCommand).mockReturnValue({
      written: ["/home/user/project/exists.txt", "/home/user/project/missing.txt"],
      read: [],
    });

    const result = resolveFilesFromToolResult("bash", { command: "cmd" }, CWD);
    expect(result).toEqual(["/home/user/project/exists.txt"]);
  });

  it("deduplicates file paths", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult(
      "write",
      { path: "/home/user/project/src/foo.ts" },
      CWD,
    );
    // Should not duplicate even if called with same path
    expect(result).toHaveLength(1);
  });
});

// ── runChecks ───────────────────────────────────────────────────────

describe("runChecks", () => {
  const baseConfig: LensConfig = {
    prettier: false,
    linters: false,
    lsp: false,
    tsc: false,
    includePatterns: [],
    excludePatterns: ["node_modules/**"],
    lspDelayMs: 0,
    maxConcurrency: 4,
    prettierTimeoutMs: 15_000,
    linterTimeoutMs: 15_000,
    tscTimeoutMs: 30_000,
    bashDetection: true,
    alwaysReport: true,
  };

  const baseState: LensState = {
    detectedLinters: [],
    lspManager: null,
    config: baseConfig,
    cwd: CWD,
    prettierAvailable: true,
    tscAvailable: true,
  };

  it("returns clean message when all checks are disabled", async () => {
    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig, baseState);
    expect(result.text).toContain("all clean");
    expect(result.statuses.prettier).toBe("skipped");
    expect(result.statuses.linters).toBe("skipped");
    expect(result.statuses.lsp).toBe("skipped");
    expect(result.statuses.tsc).toBe("skipped");
  });

  it("runs prettier check when enabled", async () => {
    const config = { ...baseConfig, prettier: true };
    vi.mocked(runPrettier).mockResolvedValue([
      { file: "/home/user/project/src/foo.ts", changed: false },
    ]);

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.prettier).toBe("clean");
    expect(runPrettier).toHaveBeenCalled();
  });

  it("reports prettier issues when files need formatting", async () => {
    const config = { ...baseConfig, prettier: true };
    vi.mocked(isPrettierAvailable).mockResolvedValue(true);
    vi.mocked(runPrettier).mockResolvedValue([
      { file: "/home/user/project/src/foo.ts", changed: true },
    ]);

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.prettier).toBe("issues");
    expect(result.text).toContain("prettier");
  });

  it("runs linter check when enabled with detected linters", async () => {
    const config = { ...baseConfig, linters: true };
    const mockLinter = {
      definition: { name: "eslint", label: "ESLint", extensions: [".ts"] },
    } as DetectedLinter;
    const state = { ...baseState, detectedLinters: [mockLinter] };

    // Mock getLintersForFile to return our linter
    const { getLintersForFile } = await import("../linter-registry.js");
    vi.mocked(getLintersForFile).mockReturnValue([mockLinter]);
    vi.mocked(runLinters).mockResolvedValue([]);

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.linters).toBe("clean");
  });

  it("runs tsc check when enabled", async () => {
    const config = { ...baseConfig, tsc: true };
    vi.mocked(isTscAvailable).mockResolvedValue(true);
    vi.mocked(runTsc).mockResolvedValue({ issues: [], durationMs: 50 });

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.tsc).toBe("clean");
  });

  it("reports tsc issues", async () => {
    const config = { ...baseConfig, tsc: true };
    vi.mocked(isTscAvailable).mockResolvedValue(true);
    vi.mocked(runTsc).mockResolvedValue({
      issues: [
        {
          file: "/home/user/project/src/foo.ts",
          line: 10,
          column: 5,
          severity: "error" as const,
          message: "Type error",
          code: "TS2322",
        },
      ],
      durationMs: 100,
    });

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.tsc).toBe("issues");
    expect(result.text).toContain("tsc");
  });

  it("skips prettier when not available", async () => {
    const config = { ...baseConfig, prettier: true };
    const state = { ...baseState, prettierAvailable: false };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.prettier).toBe("skipped");
  });

  it("skips tsc when not available", async () => {
    const config = { ...baseConfig, tsc: true };
    const state = { ...baseState, tscAvailable: false };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.tsc).toBe("skipped");
  });

  it("returns empty text when alwaysReport is false and all clean", async () => {
    const config = { ...baseConfig, alwaysReport: false };
    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.text).toBe("");
  });

  it("includes duration in result", async () => {
    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig, baseState);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles lsp check when enabled with manager", async () => {
    const config = { ...baseConfig, lsp: true };
    vi.mocked(languageFromPath).mockReturnValue({ language: "typescript" } as never);

    const mockGetDiagnostics = vi.fn().mockResolvedValue([]);
    const mockOnFileChanged = vi.fn().mockResolvedValue(undefined);
    const mockLspManager = {
      getDiagnostics: mockGetDiagnostics,
      onFileChanged: mockOnFileChanged,
    } as never;
    const state = { ...baseState, lspManager: mockLspManager };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.lsp).toBe("clean");
    expect(mockOnFileChanged).toHaveBeenCalledWith("/home/user/project/src/foo.ts");
  });

  it("handles lsp with diagnostics", async () => {
    const config = { ...baseConfig, lsp: true, lspDelayMs: 0 };
    vi.mocked(languageFromPath).mockReturnValue({ language: "typescript" } as never);

    const mockDiagnostic = {
      severity: 1,
      range: { start: { line: 9, character: 4 }, end: { line: 9, character: 10 } },
      message: "Type error",
    };
    const mockGetDiagnostics = vi.fn().mockResolvedValue([mockDiagnostic]);
    const mockOnFileChanged = vi.fn().mockResolvedValue(undefined);
    const { countSeverities } = await import("../output-formatter.js");
    vi.mocked(countSeverities).mockReturnValue({ errors: 1, warnings: 0, info: 0 });

    const mockLspManager = {
      getDiagnostics: mockGetDiagnostics,
      onFileChanged: mockOnFileChanged,
    } as never;
    const state = { ...baseState, lspManager: mockLspManager };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.lsp).toBe("issues");
  });

  // ── Additional branch coverage for runChecks ────────────────────────

  it("handles prettier with errored files", async () => {
    const config = { ...baseConfig, prettier: true };
    vi.mocked(isPrettierAvailable).mockResolvedValue(true);
    vi.mocked(runPrettier).mockResolvedValue([
      { file: "/home/user/project/src/foo.ts", changed: false, error: "parse error" },
    ]);

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.prettier).toBe("error");
    // Error status but no issues — still shows clean message when alwaysReport=true
  });

  it("handles prettier with clean results (no changes, no errors)", async () => {
    const config = { ...baseConfig, prettier: true };
    vi.mocked(isPrettierAvailable).mockResolvedValue(true);
    vi.mocked(runPrettier).mockResolvedValue([
      { file: "/home/user/project/src/foo.ts", changed: false },
    ]);

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.prettier).toBe("clean");
  });

  it("handles prettier check failure (exception)", async () => {
    const config = { ...baseConfig, prettier: true };
    vi.mocked(isPrettierAvailable).mockResolvedValue(true);
    vi.mocked(runPrettier).mockRejectedValue(new Error("prettier crashed"));

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.prettier).toBe("error");
  });

  it("skips linters when config enabled but no relevant linters for file type", async () => {
    const config = { ...baseConfig, linters: true };
    const mockLinter = {
      definition: { name: "eslint", label: "ESLint", extensions: [".ts"] },
    } as DetectedLinter;
    const state = { ...baseState, detectedLinters: [mockLinter] };

    const { getLintersForFile } = await import("../linter-registry.js");
    vi.mocked(getLintersForFile).mockReturnValue([]);

    const result = await runChecks(["/home/user/project/src/style.css"], CWD, config, state);
    expect(result.statuses.linters).toBe("skipped");
  });

  it("handles linter check failure (exception)", async () => {
    const config = { ...baseConfig, linters: true };
    const mockLinter = {
      definition: { name: "eslint", label: "ESLint", extensions: [".ts"] },
    } as DetectedLinter;
    const state = { ...baseState, detectedLinters: [mockLinter] };

    const { getLintersForFile } = await import("../linter-registry.js");
    vi.mocked(getLintersForFile).mockReturnValue([mockLinter]);
    vi.mocked(runLinters).mockRejectedValue(new Error("linter crashed"));

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.linters).toBe("error");
  });

  it("handles linter issues found with formatting", async () => {
    const config = { ...baseConfig, linters: true };
    const mockLinter = {
      definition: { name: "eslint", label: "ESLint", extensions: [".ts"] },
    } as DetectedLinter;
    const state = { ...baseState, detectedLinters: [mockLinter] };

    const { getLintersForFile } = await import("../linter-registry.js");
    vi.mocked(getLintersForFile).mockReturnValue([mockLinter]);
    vi.mocked(runLinters).mockResolvedValue([
      {
        file: "/home/user/project/src/foo.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "Test error",
        code: "no-unused-vars",
        source: "eslint",
      },
    ]);
    const { summarizeIssues, formatIssues } = await import("../output-formatter.js");
    vi.mocked(summarizeIssues).mockReturnValue("1 error(s)");
    vi.mocked(formatIssues).mockReturnValue("  formatted issue");

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.linters).toBe("issues");
    expect(summarizeIssues).toHaveBeenCalled();
    expect(formatIssues).toHaveBeenCalled();
  });

  it("skips lsp when no files with known language", async () => {
    const config = { ...baseConfig, lsp: true };
    vi.mocked(languageFromPath).mockReturnValue(undefined);

    const mockOnFileChanged = vi.fn().mockResolvedValue(undefined);
    const mockLspManager = {
      getDiagnostics: vi.fn().mockResolvedValue([]),
      onFileChanged: mockOnFileChanged,
    };
    const state = { ...baseState, lspManager: mockLspManager as never };

    const result = await runChecks(["/home/user/project/src/unknown.xyz"], CWD, config, state);
    expect(result.statuses.lsp).toBe("skipped");
    expect(mockOnFileChanged).not.toHaveBeenCalled();
  });

  it("handles lsp check failure (exception)", async () => {
    const config = { ...baseConfig, lsp: true, lspDelayMs: 0 };
    vi.mocked(languageFromPath).mockReturnValue({ language: "typescript" } as never);

    const mockOnFileChanged = vi.fn().mockRejectedValue(new Error("lsp error"));
    const mockLspManager = {
      getDiagnostics: vi.fn(),
      onFileChanged: mockOnFileChanged,
    } as never;
    const state = { ...baseState, lspManager: mockLspManager };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.lsp).toBe("error");
  });

  it("handles tsc error result", async () => {
    const config = { ...baseConfig, tsc: true };
    vi.mocked(isTscAvailable).mockResolvedValue(true);
    vi.mocked(runTsc).mockResolvedValue({
      error: "tsconfig.json not found",
      issues: [],
      durationMs: 50,
    });

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.tsc).toBe("error");
  });

  it("handles tsc check failure (exception)", async () => {
    const config = { ...baseConfig, tsc: true };
    vi.mocked(isTscAvailable).mockResolvedValue(true);
    vi.mocked(runTsc).mockRejectedValue(new Error("tsc crashed"));

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, baseState);
    expect(result.statuses.tsc).toBe("error");
  });

  it("skips tsc for non-TS files", async () => {
    const config = { ...baseConfig, tsc: true };
    vi.mocked(isTscAvailable).mockResolvedValue(true);

    const result = await runChecks(["/home/user/project/src/style.css"], CWD, config, baseState);
    expect(result.statuses.tsc).toBe("skipped");
  });

  it("skips lsp when config disabled even with lspManager", async () => {
    const config = { ...baseConfig, lsp: false };
    const mockLspManager = {
      getDiagnostics: vi.fn(),
      onFileChanged: vi.fn(),
    } as never;
    const state = { ...baseState, lspManager: mockLspManager };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.lsp).toBe("skipped");
  });

  it("skips lsp when lspManager is null", async () => {
    const config = { ...baseConfig, lsp: true };
    const state = { ...baseState, lspManager: null };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.lsp).toBe("skipped");
  });

  it("handles write with empty string path", () => {
    const result = resolveFilesFromToolResult("write", { path: "" }, CWD);
    expect(result).toEqual([]);
  });

  it("handles bash with non-string command", () => {
    const result = resolveFilesFromToolResult("bash", { command: 123 }, CWD);
    expect(result).toEqual([]);
  });

  it("handles bash with empty string command", () => {
    const result = resolveFilesFromToolResult("bash", { command: "" }, CWD);
    expect(result).toEqual([]);
  });

  it("deduplicates duplicate paths from bash detection", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(detectFilesFromBashCommand).mockReturnValue({
      written: ["/home/user/project/src/foo.ts", "/home/user/project/src/foo.ts"],
      read: [],
    });

    const result = resolveFilesFromToolResult("bash", { command: "cmd" }, CWD);
    expect(result).toHaveLength(1);
  });

  it("handles existsSync throwing an error", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockImplementation(() => {
      throw new Error("permission denied");
    });
    vi.mocked(detectFilesFromBashCommand).mockReturnValue({
      written: ["/home/user/project/src/foo.ts"],
      read: [],
    });

    const result = resolveFilesFromToolResult("bash", { command: "cmd" }, CWD);
    expect(result).toEqual([]);
  });

  it("skips linters when config disabled", async () => {
    const config = { ...baseConfig, linters: false };
    const mockLinter = {
      definition: { name: "eslint", label: "ESLint", extensions: [".ts"] },
    } as DetectedLinter;
    const state = { ...baseState, detectedLinters: [mockLinter] };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.linters).toBe("skipped");
  });

  it("skips linters when detectedLinters is empty", async () => {
    const config = { ...baseConfig, linters: true };
    const state = { ...baseState, detectedLinters: [] };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config, state);
    expect(result.statuses.linters).toBe("skipped");
  });
});

// ── formatCleanMessage ──────────────────────────────────────────────

describe("formatCleanMessage", () => {
  it("formats clean message correctly", () => {
    const msg = formatCleanMessage(3, 234);
    expect(msg).toBe("🔍 pi-lens: 3 file(s) checked — all clean (234ms)");
  });

  it("formats with 0 files", () => {
    const msg = formatCleanMessage(0, 0);
    expect(msg).toBe("🔍 pi-lens: 0 file(s) checked — all clean (0ms)");
  });
});
