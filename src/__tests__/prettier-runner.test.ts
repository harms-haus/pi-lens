import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock spawn-utils execCommand
const mockExecCommand = vi.fn();
vi.mock("../spawn-utils.js", () => ({
  execCommand: (...args: unknown[]) => mockExecCommand(...args),
}));

import { isPrettierAvailable, runPrettier } from "../prettier-runner.js";

const CWD = "/home/user/project";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isPrettierAvailable ──────────────────────────────────────────────

describe("isPrettierAvailable", () => {
  it("returns true when prettier --version succeeds", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "3.2.4\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await isPrettierAvailable(CWD);
    expect(result).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith(
      "npx",
      ["prettier", "--version"],
      expect.objectContaining({ cwd: CWD, timeout: 10_000 }),
    );
  });

  it("returns false when prettier --version fails", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "command not found",
      exitCode: 1,
    });

    const result = await isPrettierAvailable(CWD);
    expect(result).toBe(false);
  });

  it("returns false when execCommand throws", async () => {
    mockExecCommand.mockRejectedValue(new Error("spawn error"));

    const result = await isPrettierAvailable(CWD);
    expect(result).toBe(false);
  });

  it("returns false when stdout is empty", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const result = await isPrettierAvailable(CWD);
    expect(result).toBe(false);
  });
});

// ── runPrettier ──────────────────────────────────────────────────────

describe("runPrettier", () => {
  it("returns empty array when no supported files", async () => {
    const result = await runPrettier(["/home/user/project/data.csv"], CWD);
    expect(result).toEqual([]);
    expect(mockExecCommand).not.toHaveBeenCalled();
  });

  it("returns all unchanged when prettier exits 0", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const files = ["/home/user/project/src/foo.ts", "/home/user/project/src/bar.js"];
    const result = await runPrettier(files, CWD);

    expect(result).toHaveLength(2);
    expect(result.every((r) => !r.changed)).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["prettier", "--check"]),
      expect.objectContaining({ cwd: CWD, timeout: 15_000 }),
    );
  });

  it("marks files needing formatting when prettier exits 1", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "src/foo.ts\n",
      stderr: "",
      exitCode: 1,
    });

    const files = ["/home/user/project/src/foo.ts", "/home/user/project/src/bar.js"];
    const result = await runPrettier(files, CWD);

    const fooResult = result.find((r) => r.file.includes("foo.ts"));
    const barResult = result.find((r) => r.file.includes("bar.js"));

    expect(fooResult?.changed).toBe(true);
    expect(barResult?.changed).toBe(false);
  });

  it("filters to supported extensions only", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const files = [
      "/home/user/project/src/foo.ts",
      "/home/user/project/src/data.csv",
      "/home/user/project/src/style.css",
    ];

    await runPrettier(files, CWD);

    const callArgs = mockExecCommand.mock.calls[0][1] as string[];
    expect(callArgs).toContain("/home/user/project/src/foo.ts");
    expect(callArgs).toContain("/home/user/project/src/style.css");
    expect(callArgs).not.toContain("/home/user/project/src/data.csv");
  });

  it("handles exec error gracefully", async () => {
    mockExecCommand.mockRejectedValue(new Error("spawn failed"));

    const files = ["/home/user/project/src/foo.ts"];
    const result = await runPrettier(files, CWD);

    expect(result).toHaveLength(1);
    expect(result[0]!.error).toContain("spawn failed");
    expect(result[0]!.changed).toBe(false);
  });

  it("handles unexpected exit code as error", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "something went wrong",
      exitCode: 2,
    });

    const files = ["/home/user/project/src/foo.ts"];
    const result = await runPrettier(files, CWD);

    expect(result).toHaveLength(1);
    expect(result[0]!.error).toContain("prettier exited with code 2");
    expect(result[0]!.changed).toBe(false);
  });

  it("passes AbortSignal through", async () => {
    mockExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const controller = new AbortController();
    const files = ["/home/user/project/src/foo.ts"];
    await runPrettier(files, CWD, controller.signal);

    expect(mockExecCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
