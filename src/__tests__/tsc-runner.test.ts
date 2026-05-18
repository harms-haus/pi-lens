import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";

// Mock spawn-utils execCommand
const mockExecCommand = vi.fn();
vi.mock("../spawn-utils.js", () => ({
  execCommand: (...args: unknown[]) => mockExecCommand(...args),
}));

// Mock node:fs for detectTsconfig and isTscAvailable
vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { isTscAvailable, detectTsconfig, runTsc } from "../tsc-runner.js";

const CWD = "/home/user/project";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isTscAvailable ──────────────────────────────────────────────────

describe("isTscAvailable", () => {
  it("returns true when tsconfig.json exists and tsc --version succeeds", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    mockExecCommand.mockResolvedValue({
      stdout: "Version 5.3.3\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await isTscAvailable(CWD);
    expect(result).toBe(true);
  });

  it("returns false when no tsconfig.json", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await isTscAvailable(CWD);
    expect(result).toBe(false);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  it("returns false when tsc is not installed", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    mockExecCommand.mockRejectedValue(new Error("command not found"));

    const result = await isTscAvailable(CWD);
    expect(result).toBe(false);
  });

  it("returns false when tsc --version exits non-zero", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "error",
      exitCode: 1,
    });

    const result = await isTscAvailable(CWD);
    expect(result).toBe(false);
  });
});

// ── detectTsconfig ──────────────────────────────────────────────────

describe("detectTsconfig", () => {
  it("returns tsconfig.json path when file exists", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    const result = detectTsconfig(CWD);
    expect(result).toBe(path.join(CWD, "tsconfig.json"));
  });

  it("returns undefined when tsconfig.json does not exist", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);

    const result = detectTsconfig(CWD);
    expect(result).toBeUndefined();
  });
});

// ── runTsc ──────────────────────────────────────────────────────────

describe("runTsc", () => {
  it("returns empty issues for clean compilation (exit 0)", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const result = await runTsc(CWD);
    expect(result.issues).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("parses error lines from tsc output", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: [
        "src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'",
        "src/bar.ts(20,1): error TS2304: Cannot find name 'x'",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    });

    const result = await runTsc(CWD);
    expect(result.issues).toHaveLength(2);

    const fooIssue = result.issues.find((i) => i.file.includes("foo.ts"));
    expect(fooIssue).toMatchObject({
      line: 10,
      column: 5,
      severity: "error",
      message: "Type 'string' is not assignable to type 'number'",
      code: "TS2322",
    });

    const barIssue = result.issues.find((i) => i.file.includes("bar.ts"));
    expect(barIssue).toMatchObject({
      line: 20,
      column: 1,
      severity: "error",
      message: "Cannot find name 'x'",
      code: "TS2304",
    });
  });

  it("parses warning lines from tsc output", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "src/foo.ts(5,10): warning TS7028: Unused label",
      stderr: "",
      exitCode: 1,
    });

    const result = await runTsc(CWD);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.severity).toBe("warning");
    expect(result.issues[0]?.code).toBe("TS7028");
  });

  it("filters issues to specific files when files parameter provided", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: [
        "src/foo.ts(10,5): error TS2322: Type error",
        "src/bar.ts(20,1): error TS2304: Cannot find name",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    });

    const result = await runTsc(CWD, [path.resolve(CWD, "src/foo.ts")]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.file).toContain("foo.ts");
  });

  it("returns all issues when files parameter is empty array", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: [
        "src/foo.ts(10,5): error TS2322: Type error",
        "src/bar.ts(20,1): error TS2304: Cannot find name",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    });

    const result = await runTsc(CWD, []);
    expect(result.issues).toHaveLength(2);
  });

  it("skips malformed output lines", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: [
        "this is not a diagnostic",
        "src/foo.ts(10,5): error TS2322: Real error",
        "",
        "also not valid",
      ].join("\n"),
      stderr: "",
      exitCode: 1,
    });

    const result = await runTsc(CWD);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.message).toBe("Real error");
  });

  it("handles exec timeout/error gracefully", async () => {
    mockExecCommand.mockRejectedValue(new Error("timed out"));

    const result = await runTsc(CWD);
    expect(result.issues).toEqual([]);
    expect(result.error).toContain("timed out");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles non-zero exit with empty stdout as execution error", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "tsc crashed",
      exitCode: 2,
    });

    const result = await runTsc(CWD);
    expect(result.issues).toEqual([]);
    expect(result.error).toContain("tsc exited with code 2");
  });

  it("passes AbortSignal through to execCommand", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const controller = new AbortController();
    await runTsc(CWD, undefined, controller.signal);

    expect(mockExecCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("uses --noEmit --pretty false flags", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    await runTsc(CWD);
    expect(mockExecCommand).toHaveBeenCalledWith(
      "npx",
      ["tsc", "--noEmit", "--pretty", "false"],
      expect.objectContaining({ cwd: CWD, timeout: 30_000 }),
    );
  });
});
