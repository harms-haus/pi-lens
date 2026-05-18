import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatIssues, summarizeIssues, runLinter, runLinters } from "../linter-runner.js";
import { countSeverities, formatDiagnosticLine } from "../output-formatter.js";
import type { DetectedLinter, LintIssue } from "../types.js";

describe("formatIssues", () => {
  it("returns empty string for empty array", () => {
    const result = formatIssues([]);
    expect(result).toBe("");
  });

  it("formats single error issue with code and source", () => {
    const issues: LintIssue[] = [
      {
        file: "/absolute/path/file.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "msg",
        code: "code",
        source: "source",
      },
    ];
    const result = formatIssues(issues);
    expect(result).toBe(" ✗ /absolute/path/file.ts:10:5: msg (code) [source]");
  });

  it("uses relative path when cwd is provided", () => {
    const issues: LintIssue[] = [
      {
        file: "/my/project/src/file.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "msg",
        code: "code",
        source: "source",
      },
    ];
    const result = formatIssues(issues, "/my/project");
    expect(result).toBe(" ✗ src/file.ts:10:5: msg (code) [source]");
  });

  it("uses absolute path when cwd is not provided", () => {
    const issues: LintIssue[] = [
      {
        file: "/absolute/path/file.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "msg",
        code: "code",
        source: "source",
      },
    ];
    const result = formatIssues(issues);
    expect(result).toContain("/absolute/path/file.ts");
  });

  it("formats warning issue with ⚠ icon", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "warning",
        message: "msg",
        code: "code",
        source: "source",
      },
    ];
    const result = formatIssues(issues);
    expect(result).toBe(" ⚠ /path/file.ts:10:5: msg (code) [source]");
  });

  it("formats info issue with ℹ icon", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "info",
        message: "msg",
        code: "code",
        source: "source",
      },
    ];
    const result = formatIssues(issues);
    expect(result).toBe(" ℹ /path/file.ts:10:5: msg (code) [source]");
  });

  it("formats issue without code (no parentheses)", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "msg",
        source: "source",
      },
    ];
    const result = formatIssues(issues);
    expect(result).toBe(" ✗ /path/file.ts:10:5: msg [source]");
  });

  it("truncates output when there are more than 2000 issues", () => {
    const issues: LintIssue[] = Array.from({ length: 2001 }, (_, i) => ({
      file: `/path/file${i}.ts`,
      line: 10,
      column: 5,
      severity: "error" as const,
      message: `msg ${i}`,
      code: "code",
      source: "source",
    }));
    const result = formatIssues(issues);
    expect(result).toContain("... (output truncated)");
    expect(result.split("\n").length).toBeLessThanOrEqual(2001);
  });

  it("truncates output when byte length exceeds 50KB", () => {
    const longMessage = "x".repeat(51 * 1024);
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: longMessage,
        code: "code",
        source: "source",
      },
    ];
    const result = formatIssues(issues);
    expect(result).toContain("... (output truncated)");
    expect(Buffer.byteLength(result, "utf-8")).toBeGreaterThan(50 * 1024);
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThan(
      51 * 1024 + "... (output truncated)".length,
    );
  });

  it("formats multiple issues with newline separation", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file1.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "error msg",
        code: "ERR001",
        source: "eslint",
      },
      {
        file: "/path/file2.ts",
        line: 20,
        column: 8,
        severity: "warning",
        message: "warning msg",
        code: "WARN001",
        source: "eslint",
      },
      {
        file: "/path/file3.ts",
        line: 30,
        column: 1,
        severity: "info",
        message: "info msg",
        code: "INFO001",
        source: "eslint",
      },
    ];
    const result = formatIssues(issues);
    expect(result).toBe(
      " ✗ /path/file1.ts:10:5: error msg (ERR001) [eslint]\n ⚠ /path/file2.ts:20:8: warning msg (WARN001) [eslint]\n ℹ /path/file3.ts:30:1: info msg (INFO001) [eslint]",
    );
  });
});

describe("summarizeIssues", () => {
  it("returns 'No lint issues found.' for empty array", () => {
    const result = summarizeIssues([]);
    expect(result).toBe("No lint issues found.");
  });

  it("summarizes mix of errors, warnings, and infos in 3 files", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file1.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "e1",
        code: "E1",
        source: "eslint",
      },
      {
        file: "/path/file2.ts",
        line: 20,
        column: 8,
        severity: "error",
        message: "e2",
        code: "E2",
        source: "eslint",
      },
      {
        file: "/path/file1.ts",
        line: 30,
        column: 1,
        severity: "warning",
        message: "w1",
        code: "W1",
        source: "eslint",
      },
      {
        file: "/path/file3.ts",
        line: 15,
        column: 3,
        severity: "info",
        message: "i1",
        code: "I1",
        source: "eslint",
      },
    ];
    const result = summarizeIssues(issues);
    expect(result).toBe("Lint Results: 2 error(s), 1 warning(s), 1 info(s), in 3 file(s)");
  });

  it("summarizes only errors", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "error",
        code: "E1",
        source: "eslint",
      },
    ];
    const result = summarizeIssues(issues);
    expect(result).toBe("Lint Results: 1 error(s), in 1 file(s)");
  });

  it("summarizes only warnings", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "warning",
        message: "warning",
        code: "W1",
        source: "eslint",
      },
    ];
    const result = summarizeIssues(issues);
    expect(result).toBe("Lint Results: 1 warning(s), in 1 file(s)");
  });

  it("summarizes only infos", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "info",
        message: "info",
        code: "I1",
        source: "eslint",
      },
    ];
    const result = summarizeIssues(issues);
    expect(result).toBe("Lint Results: 1 info(s), in 1 file(s)");
  });

  it("counts unique files correctly", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "e1",
        code: "E1",
        source: "eslint",
      },
      {
        file: "/path/file.ts",
        line: 20,
        column: 8,
        severity: "error",
        message: "e2",
        code: "E2",
        source: "eslint",
      },
      {
        file: "/path/file.ts",
        line: 30,
        column: 1,
        severity: "warning",
        message: "w1",
        code: "W1",
        source: "eslint",
      },
    ];
    const result = summarizeIssues(issues);
    expect(result).toBe("Lint Results: 2 error(s), 1 warning(s), in 1 file(s)");
  });

  it("handles multiple issues in multiple files", () => {
    const issues: LintIssue[] = [
      {
        file: "/path/file1.ts",
        line: 10,
        column: 5,
        severity: "error",
        message: "e1",
        code: "E1",
        source: "eslint",
      },
      {
        file: "/path/file1.ts",
        line: 20,
        column: 8,
        severity: "warning",
        message: "w1",
        code: "W1",
        source: "eslint",
      },
      {
        file: "/path/file2.ts",
        line: 30,
        column: 1,
        severity: "error",
        message: "e2",
        code: "E2",
        source: "eslint",
      },
      {
        file: "/path/file2.ts",
        line: 40,
        column: 3,
        severity: "warning",
        message: "w2",
        code: "W2",
        source: "eslint",
      },
      {
        file: "/path/file3.ts",
        line: 50,
        column: 5,
        severity: "info",
        message: "i1",
        code: "I1",
        source: "eslint",
      },
    ];
    const result = summarizeIssues(issues);
    expect(result).toBe("Lint Results: 2 error(s), 2 warning(s), 1 info(s), in 3 file(s)");
  });
});

describe("countSeverities", () => {
  it("returns all zeros for empty array", () => {
    const result = countSeverities([]);
    expect(result).toEqual({ errors: 0, warnings: 0, info: 0 });
  });

  it("counts LSP severity codes correctly", () => {
    const diagnostics = [
      { severity: 1 }, // Error
      { severity: 1 }, // Error
      { severity: 2 }, // Warning
      { severity: 3 }, // Info
      { severity: 4 }, // Hint → info
      { severity: undefined }, // ignored
    ];
    const result = countSeverities(diagnostics);
    expect(result).toEqual({ errors: 2, warnings: 1, info: 2 });
  });
});

describe("formatDiagnosticLine", () => {
  it("formats a basic diagnostic", () => {
    const result = formatDiagnosticLine({
      range: { start: { line: 9, character: 4 } },
      severity: 1,
      source: "typescript",
      message: "Type 'string' is not assignable to type 'number'",
      code: 2322,
    });
    expect(result).toBe(
      "  Error: 10:5: [typescript] Type 'string' is not assignable to type 'number' (2322)",
    );
  });

  it("formats diagnostic without source", () => {
    const result = formatDiagnosticLine({
      range: { start: { line: 0, character: 0 } },
      severity: 2,
      message: "Some warning",
    });
    expect(result).toBe("  Warning: 1:1: Some warning");
  });

  it("formats diagnostic with object code", () => {
    const result = formatDiagnosticLine({
      range: { start: { line: 4, character: 9 } },
      severity: 3,
      source: "eslint",
      message: "Unused var",
      code: { value: "no-unused-vars" },
    });
    expect(result).toBe("  Info: 5:10: [eslint] Unused var (no-unused-vars)");
  });
});

// ── runLinter / runLinters ─────────────────────────────────────────────

vi.mock("../spawn-utils.js", () => ({
  execCommand: vi.fn(),
}));

import { execCommand } from "../spawn-utils.js";

const mockedExecCommand = vi.mocked(execCommand);

function makeLinter(name: string, extensions: string[]): DetectedLinter {
  return {
    definition: {
      name,
      label: name,
      languages: [],
      extensions,
      configFiles: [],
      versionCommand: `${name} --version`,
      lintCommand: (files: string[]) => [name, "--format", "json", ...files],
      parseOutput: (stdout: string) => {
        try {
          return JSON.parse(stdout) as LintIssue[];
        } catch {
          return [];
        }
      },
      timeout: 15000,
    },
    configFile: undefined,
    version: "1.0.0",
    detectionSource: "config-file",
  };
}

describe("runLinter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for empty files list", async () => {
    const linter = makeLinter("eslint", [".ts"]);
    const result = await runLinter(linter, [], "/test");
    expect(result).toEqual([]);
    expect(mockedExecCommand).not.toHaveBeenCalled();
  });

  it("returns parsed issues from stdout", async () => {
    const linter = makeLinter("eslint", [".ts"]);
    const issues: LintIssue[] = [
      {
        file: "/test/file.ts",
        line: 1,
        column: 1,
        severity: "error",
        message: "test error",
        code: "E001",
        source: "eslint",
      },
    ];
    mockedExecCommand.mockResolvedValue({
      stdout: JSON.stringify(issues),
      stderr: "",
      exitCode: 1,
    });

    const result = await runLinter(linter, ["/test/file.ts"], "/test");
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("test error");
  });

  it("returns empty array when stdout is empty", async () => {
    const linter = makeLinter("eslint", [".ts"]);
    mockedExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const result = await runLinter(linter, ["/test/file.ts"], "/test");
    expect(result).toEqual([]);
  });

  it("returns empty array on exec error", async () => {
    const linter = makeLinter("eslint", [".ts"]);
    mockedExecCommand.mockRejectedValue(new Error("spawn failed"));

    const result = await runLinter(linter, ["/test/file.ts"], "/test");
    expect(result).toEqual([]);
  });
});

describe("runLinters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no linters provided", async () => {
    const result = await runLinters([], ["/test/file.ts"], "/test");
    expect(result).toEqual([]);
  });

  it("returns empty array when no files provided", async () => {
    const linters = [makeLinter("eslint", [".ts"])];
    const result = await runLinters(linters, [], "/test");
    expect(result).toEqual([]);
  });

  it("runs multiple linters in parallel and merges results", async () => {
    const eslintLinter = makeLinter("eslint", [".ts", ".js"]);
    const ruffLinter = makeLinter("ruff", [".py"]);

    mockedExecCommand.mockImplementation((cmd, _args, _opts) => {
      if (cmd === "eslint") {
        return Promise.resolve({
          stdout: JSON.stringify([
            {
              file: "/test/file.ts",
              line: 1,
              column: 1,
              severity: "error",
              message: "eslint error",
              code: "E001",
              source: "eslint",
            },
          ]),
          stderr: "",
          exitCode: 1,
        });
      }
      if (cmd === "ruff") {
        return Promise.resolve({
          stdout: JSON.stringify([
            {
              file: "/test/file.py",
              line: 5,
              column: 3,
              severity: "warning",
              message: "ruff warning",
              code: "W001",
              source: "ruff",
            },
          ]),
          stderr: "",
          exitCode: 1,
        });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    });

    const result = await runLinters(
      [eslintLinter, ruffLinter],
      ["/test/file.ts", "/test/file.py"],
      "/test",
    );
    expect(result).toHaveLength(2);
    expect(result.some((r) => r.source === "eslint")).toBe(true);
    expect(result.some((r) => r.source === "ruff")).toBe(true);
  });

  it("skips linters with no matching files", async () => {
    const ruffLinter = makeLinter("ruff", [".py"]);
    mockedExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const result = await runLinters([ruffLinter], ["/test/file.ts"], "/test");
    expect(result).toEqual([]);
    expect(mockedExecCommand).not.toHaveBeenCalled();
  });
});
