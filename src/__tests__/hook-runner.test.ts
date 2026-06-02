import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";
import * as os from "node:os";

// Mock node:fs for resolveFilesFromToolResult (existsSync check)
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

// Mock internal modules
vi.mock("../bash-file-detector.js", () => ({
  detectFilesFromBashCommand: vi.fn(),
}));

vi.mock("@harms-haus/code-lens/client", () => ({
  sendRequest: vi.fn(),
  getSocketPath: vi.fn().mockReturnValue("/tmp/code-lens-test.sock"),
}));

import {
  resolveFilesFromToolResult,
  runChecks,
  formatSummaryLine,
  filterFilesByPatterns,
} from "../hook-runner.js";
import type { LensConfig } from "../types.js";
import type { HookCheckStatuses } from "../hook-runner.js";
import { detectFilesFromBashCommand } from "../bash-file-detector.js";
import { sendRequest, getSocketPath } from "@harms-haus/code-lens/client";

/** Platform-aware CWD that resolves to a real absolute path on any OS */
const CWD = path.join(os.tmpdir(), "pi-lens-test-project");
/** Helper to build an absolute path under CWD with forward slashes */
function cwdPath(...segments: string[]): string {
  return path
    .resolve(CWD, ...segments)
    .split(path.sep)
    .join("/");
}

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

beforeEach(() => {
  vi.clearAllMocks();
});

// ── resolveFilesFromToolResult ───────────────────────────────────────

describe("resolveFilesFromToolResult", () => {
  it("resolves write tool with absolute path", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult("write", { path: cwdPath("src", "foo.ts") }, CWD);
    expect(result).toEqual([cwdPath("src", "foo.ts")]);
  });

  it("resolves write tool with relative path against cwd", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult("write", { path: "src/foo.ts" }, CWD);
    expect(result).toEqual([cwdPath("src", "foo.ts")]);
  });

  it("resolves edit tool with path", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult("edit", { path: cwdPath("src", "bar.ts") }, CWD);
    expect(result).toEqual([cwdPath("src", "bar.ts")]);
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
    expect(result).toEqual([cwdPath("modified.txt")]);
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
      written: [cwdPath("exists.txt"), cwdPath("missing.txt")],
      read: [],
    });

    const result = resolveFilesFromToolResult("bash", { command: "cmd" }, CWD);
    expect(result).toEqual([cwdPath("exists.txt")]);
  });

  it("deduplicates file paths", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = resolveFilesFromToolResult("write", { path: cwdPath("src", "foo.ts") }, CWD);
    // Should not duplicate even if called with same path
    expect(result).toHaveLength(1);
  });

  it("filters out paths outside cwd (path traversal)", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    const result = resolveFilesFromToolResult("write", { path: "../../../etc/passwd" }, CWD);
    expect(result).toEqual([]);
  });

  it("filters out absolute paths outside cwd", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    const result = resolveFilesFromToolResult(
      "write",
      { path: path.resolve(os.tmpdir(), "other-project", "secret.txt") },
      CWD,
    );
    expect(result).toEqual([]);
  });

  it("skips bash detection when bashDetection is false", async () => {
    const config = { ...baseConfig, bashDetection: false };
    const result = resolveFilesFromToolResult(
      "bash",
      { command: "sed -i 's/a/b/g' file.txt" },
      CWD,
      config,
    );
    expect(result).toEqual([]);
  });
});

// ── runChecks ───────────────────────────────────────────────────────

describe("runChecks", () => {
  /** Helper to create a mock fullCheck response */
  function mockFullCheckResponse(overrides: {
    statuses?: { prettier?: string; linters?: string; lsp?: string; tsc?: string };
    hasIssues?: boolean;
    text?: string;
    isError?: boolean;
  }) {
    const response = {
      isError: overrides.isError ?? false,
      content: [
        {
          type: "text" as const,
          text: overrides.text ?? "",
        },
      ],
      details: {
        statuses: overrides.statuses ?? {
          prettier: "skipped",
          linters: "skipped",
          lsp: "skipped",
          tsc: "skipped",
        },
        hasIssues: overrides.hasIssues ?? false,
        fileCount: 1,
        durationMs: 100,
      },
    };
    vi.mocked(sendRequest).mockResolvedValue(response);
    return response;
  }

  it("returns clean message when daemon reports all checks skipped", async () => {
    mockFullCheckResponse({});

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.text).toContain("pi-lens");
    expect(result.text).toContain("⊘ prettier");
    expect(result.statuses.prettier).toBe("skipped");
    expect(result.statuses.linters).toBe("skipped");
    expect(result.statuses.lsp).toBe("skipped");
    expect(result.statuses.tsc).toBe("skipped");
  });

  it("sends fullCheck request with correct params", async () => {
    mockFullCheckResponse({});
    const config = { ...baseConfig, prettier: true, linters: true, lsp: true, tsc: true };

    await runChecks([cwdPath("src", "foo.ts")], CWD, config);

    expect(getSocketPath).toHaveBeenCalledWith(CWD);
    expect(sendRequest).toHaveBeenCalledWith(
      "/tmp/code-lens-test.sock",
      expect.objectContaining({
        jsonrpc: "2.0",
        method: "fullCheck",
        params: expect.objectContaining({
          files: [cwdPath("src", "foo.ts")],
          config: expect.objectContaining({
            prettier: true,
            linters: true,
            lsp: true,
            tsc: true,
          }),
        }),
      }),
    );
  });

  it("reports issues from daemon response", async () => {
    mockFullCheckResponse({
      statuses: {
        prettier: "issues",
        linters: "clean",
        lsp: "skipped",
        tsc: "skipped",
      },
      hasIssues: true,
      text: "  ⚠ prettier: 1 file(s) need formatting\n    src/foo.ts",
    });

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("issues");
    expect(result.statuses.linters).toBe("clean");
    expect(result.text).toContain("pi-lens");
    expect(result.text).toContain("prettier");
  });

  it("reports multiple check statuses from daemon", async () => {
    mockFullCheckResponse({
      statuses: {
        prettier: "clean",
        linters: "issues",
        lsp: "clean",
        tsc: "issues",
      },
      hasIssues: true,
      text: "  ✅ prettier: 1 file(s) formatted correctly\n  ⚠ linters: 1 error(s)\n  ✅ lsp: 0 diagnostics\n  ⚠ tsc: 2 error(s)",
    });

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("clean");
    expect(result.statuses.linters).toBe("issues");
    expect(result.statuses.lsp).toBe("clean");
    expect(result.statuses.tsc).toBe("issues");
    expect(result.text).toContain("pi-lens");
  });

  it("returns empty text when alwaysReport is false and no issues", async () => {
    const config = { ...baseConfig, alwaysReport: false };
    mockFullCheckResponse({ hasIssues: false });

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, config);
    expect(result.text).toBe("");
  });

  it("returns empty text when daemon returns error", async () => {
    mockFullCheckResponse({ isError: true });

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.text).toBe("");
  });

  it("returns empty text when sendRequest throws", async () => {
    vi.mocked(sendRequest).mockRejectedValue(new Error("daemon error"));

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.text).toBe("");
  });

  it("includes duration in result", async () => {
    mockFullCheckResponse({});

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty text when no files after filtering", async () => {
    const config = { ...baseConfig, excludePatterns: ["**/*.ts"] };

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, config);
    expect(result.text).toBe("");
    expect(sendRequest).not.toHaveBeenCalled();
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
      written: [cwdPath("src", "foo.ts"), cwdPath("src", "foo.ts")],
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
      written: [cwdPath("src", "foo.ts")],
      read: [],
    });

    const result = resolveFilesFromToolResult("bash", { command: "cmd" }, CWD);
    expect(result).toEqual([]);
  });

  it("uses default skipped statuses when daemon response lacks statuses", async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      isError: false,
      content: [{ type: "text" as const, text: "" }],
      details: {
        hasIssues: false,
        fileCount: 1,
        durationMs: 50,
      },
    });

    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("skipped");
    expect(result.statuses.linters).toBe("skipped");
    expect(result.statuses.lsp).toBe("skipped");
    expect(result.statuses.tsc).toBe("skipped");
  });
});

// ── parseDaemonResponse edge cases (via runChecks) ──────────────────

describe("parseDaemonResponse edge cases (via runChecks)", () => {
  beforeEach(() => {
    vi.mocked(sendRequest).mockReset();
  });

  it("handles response with missing details", async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      isError: false,
      content: [{ type: "text" as const, text: "" }],
    } as never);
    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("skipped");
  });

  it("handles response with non-object details", async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      isError: false,
      content: [{ type: "text" as const, text: "" }],
      details: "not-an-object" as unknown as Record<string, unknown>,
    });
    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("skipped");
  });

  it("handles response with non-boolean hasIssues", async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      isError: false,
      content: [{ type: "text" as const, text: "issues text" }],
      details: {
        statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" },
        hasIssues: "yes",
      },
    });
    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    // hasIssues is not boolean true → treated as false
    expect(result.text).toContain("pi-lens");
    expect(result.text).toContain("✅ prettier");
  });

  it("handles response with invalid status values", async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      isError: false,
      content: [{ type: "text" as const, text: "" }],
      details: {
        statuses: { prettier: "invalid-status", linters: 123, lsp: null, tsc: "clean" },
        hasIssues: false,
      },
    });
    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("skipped");
    expect(result.statuses.linters).toBe("skipped");
    expect(result.statuses.lsp).toBe("skipped");
    expect(result.statuses.tsc).toBe("clean");
  });

  it("handles response with empty content array", async () => {
    vi.mocked(sendRequest).mockResolvedValue({
      isError: false,
      content: [],
      details: {
        statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" },
        hasIssues: true,
      },
    });
    const result = await runChecks([cwdPath("src", "foo.ts")], CWD, baseConfig);
    expect(result.text).toContain("pi-lens");
  });
});

// ── formatSummaryLine ──────────────────────────────────────────────

describe("formatSummaryLine", () => {
  const allSkipped: HookCheckStatuses = {
    prettier: "skipped",
    linters: "skipped",
    lsp: "skipped",
    tsc: "skipped",
  };

  it("formats summary line with all skipped", () => {
    const msg = formatSummaryLine(3, 234, allSkipped);
    expect(msg).toBe("🔍 pi-lens: 3 file(s) (234ms) - ⊘ prettier • ⊘ linters • ⊘ lsp • ⊘ tsc");
  });

  it("formats with mixed statuses", () => {
    const statuses: HookCheckStatuses = {
      prettier: "clean",
      linters: "issues",
      lsp: "skipped",
      tsc: "error",
    };
    const msg = formatSummaryLine(1, 100, statuses);
    expect(msg).toBe("🔍 pi-lens: 1 file(s) (100ms) - ✅ prettier • ⚠ linters • ⊘ lsp • ✗ tsc");
  });

  it("formats with 0 files", () => {
    const msg = formatSummaryLine(0, 0, allSkipped);
    expect(msg).toBe("🔍 pi-lens: 0 file(s) (0ms) - ⊘ prettier • ⊘ linters • ⊘ lsp • ⊘ tsc");
  });
});

// ── filterFilesByPatterns ───────────────────────────────────────────

describe("filterFilesByPatterns", () => {
  const files = [
    cwdPath("src", "index.ts"),
    cwdPath("src", "utils", "helpers.ts"),
    cwdPath("src", "components", "App.tsx"),
    cwdPath("test", "main.test.ts"),
    cwdPath("node_modules", "lodash", "index.js"),
    cwdPath("dist", "bundle.js"),
  ];

  it("returns all files when no include or exclude patterns specified", () => {
    const result = filterFilesByPatterns(files, CWD, [], []);
    expect(result).toEqual(files);
  });

  it("filters to files matching include patterns", () => {
    const result = filterFilesByPatterns(files, CWD, ["src/**"], []);
    expect(result).toEqual([
      cwdPath("src", "index.ts"),
      cwdPath("src", "utils", "helpers.ts"),
      cwdPath("src", "components", "App.tsx"),
    ]);
  });

  it("excludes files matching exclude patterns", () => {
    const result = filterFilesByPatterns(files, CWD, [], ["node_modules/**"]);
    expect(result).toEqual([
      cwdPath("src", "index.ts"),
      cwdPath("src", "utils", "helpers.ts"),
      cwdPath("src", "components", "App.tsx"),
      cwdPath("test", "main.test.ts"),
      cwdPath("dist", "bundle.js"),
    ]);
  });

  it("exclude takes precedence over include", () => {
    const result = filterFilesByPatterns(files, CWD, ["src/**"], ["**/*.tsx"]);
    // src/App.tsx is included by src/** but excluded by **/*.tsx
    expect(result).toEqual([cwdPath("src", "index.ts"), cwdPath("src", "utils", "helpers.ts")]);
  });

  it("matches globstar ** patterns across directories", () => {
    const result = filterFilesByPatterns(files, CWD, ["**/*.ts"], []);
    expect(result).toEqual([
      cwdPath("src", "index.ts"),
      cwdPath("src", "utils", "helpers.ts"),
      cwdPath("test", "main.test.ts"),
    ]);
  });

  it("matches * wildcard for single path segment", () => {
    const result = filterFilesByPatterns(files, CWD, ["src/*.ts"], []);
    // Only direct children of src/ with .ts extension
    expect(result).toEqual([cwdPath("src", "index.ts")]);
  });

  it("handles calling with same patterns twice (cache hit — no error)", () => {
    const patterns: string[] = ["src/**"];
    // First call populates cache
    const result1 = filterFilesByPatterns(files, CWD, patterns, []);
    // Second call hits cache
    const result2 = filterFilesByPatterns(files, CWD, patterns, []);
    expect(result1).toEqual(result2);
    expect(result2).toEqual([
      cwdPath("src", "index.ts"),
      cwdPath("src", "utils", "helpers.ts"),
      cwdPath("src", "components", "App.tsx"),
    ]);
  });
});
