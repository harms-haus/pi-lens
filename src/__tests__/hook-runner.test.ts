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

vi.mock("@harms-haus/code-lens/client", () => ({
  sendRequest: vi.fn(),
  getSocketPath: vi.fn().mockReturnValue("/tmp/code-lens-test.sock"),
}));

import { resolveFilesFromToolResult, runChecks, formatCleanMessage } from "../hook-runner.js";
import type { LensConfig } from "../types.js";
import { detectFilesFromBashCommand } from "../bash-file-detector.js";
import { sendRequest, getSocketPath } from "@harms-haus/code-lens/client";

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

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig);
    expect(result.text).toContain("all clean");
    expect(result.statuses.prettier).toBe("skipped");
    expect(result.statuses.linters).toBe("skipped");
    expect(result.statuses.lsp).toBe("skipped");
    expect(result.statuses.tsc).toBe("skipped");
  });

  it("sends fullCheck request with correct params", async () => {
    mockFullCheckResponse({});
    const config = { ...baseConfig, prettier: true, linters: true, lsp: true, tsc: true };

    await runChecks(["/home/user/project/src/foo.ts"], CWD, config);

    expect(getSocketPath).toHaveBeenCalledWith(CWD);
    expect(sendRequest).toHaveBeenCalledWith(
      "/tmp/code-lens-test.sock",
      expect.objectContaining({
        jsonrpc: "2.0",
        method: "fullCheck",
        params: expect.objectContaining({
          files: ["/home/user/project/src/foo.ts"],
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

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig);
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

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("clean");
    expect(result.statuses.linters).toBe("issues");
    expect(result.statuses.lsp).toBe("clean");
    expect(result.statuses.tsc).toBe("issues");
    expect(result.text).toContain("pi-lens");
  });

  it("returns empty text when alwaysReport is false and no issues", async () => {
    const config = { ...baseConfig, alwaysReport: false };
    mockFullCheckResponse({ hasIssues: false });

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config);
    expect(result.text).toBe("");
  });

  it("returns empty text when daemon returns error", async () => {
    mockFullCheckResponse({ isError: true });

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig);
    expect(result.text).toBe("");
  });

  it("returns empty text when sendRequest throws", async () => {
    vi.mocked(sendRequest).mockRejectedValue(new Error("daemon error"));

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig);
    expect(result.text).toBe("");
  });

  it("includes duration in result", async () => {
    mockFullCheckResponse({});

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns empty text when no files after filtering", async () => {
    const config = { ...baseConfig, excludePatterns: ["**/*.ts"] };

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, config);
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

    const result = await runChecks(["/home/user/project/src/foo.ts"], CWD, baseConfig);
    expect(result.statuses.prettier).toBe("skipped");
    expect(result.statuses.linters).toBe("skipped");
    expect(result.statuses.lsp).toBe("skipped");
    expect(result.statuses.tsc).toBe("skipped");
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
