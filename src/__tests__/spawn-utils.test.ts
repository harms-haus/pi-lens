import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to control spawn directly for these tests, so unmock node:child_process
// and re-mock it within this file's vi.mock call.
vi.unmock("node:child_process");
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import { execCommand } from "../spawn-utils.js";

const mockedSpawn = vi.mocked(spawn);

/**
 * Helper to build a mock child process that simulates events.
 */
function createMockProcess(options: {
  stdoutData?: Buffer[];
  stderrData?: Buffer[];
  exitCode?: number | null;
  error?: Error;
  closeDelay?: number;
}) {
  type EventHandler = (...args: unknown[]) => void;
  const eventHandlers: Record<string, EventHandler[]> = {};

  const mockProc = {
    stdout: {
      on: (event: string, cb: (data: Buffer) => void) => {
        if (event === "data" && options.stdoutData) {
          for (const chunk of options.stdoutData) {
            cb(chunk);
          }
        }
      },
    },
    stderr: {
      on: (event: string, cb: (data: Buffer) => void) => {
        if (event === "data" && options.stderrData) {
          for (const chunk of options.stderrData) {
            cb(chunk);
          }
        }
      },
    },
    on: (event: string, cb: EventHandler) => {
      eventHandlers[event] ??= [];
      eventHandlers[event].push(cb);
    },
    kill: vi.fn(),
  };

  // Schedule events
  setTimeout(() => {
    if (options.error) {
      for (const h of eventHandlers["error"] ?? []) h(options.error);
    }
    const closeHandlers = eventHandlers["close"] ?? [];
    const code = options.exitCode ?? 0;
    for (const h of closeHandlers) h(code);
  }, options.closeDelay ?? 0);

  return mockProc;
}

describe("execCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns stdout, stderr, exitCode 0 for successful execution", async () => {
    const mockProc = createMockProcess({
      stdoutData: [Buffer.from("hello world")],
      stderrData: [],
      exitCode: 0,
    });
    mockedSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

    const promise = execCommand("echo", ["hello"], { cwd: "/test", timeout: 5000 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result).toEqual({
      stdout: "hello world",
      stderr: "",
      exitCode: 0,
    });
  });

  it("returns non-zero exit code from process", async () => {
    const mockProc = createMockProcess({
      stdoutData: [Buffer.from("output")],
      stderrData: [Buffer.from("error output")],
      exitCode: 1,
    });
    mockedSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

    const promise = execCommand("cmd", [], { cwd: "/test", timeout: 5000 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("output");
    expect(result.stderr).toBe("error output");
  });

  it("returns exitCode -1 on timeout", async () => {
    // Create a process that never closes (no exitCode/error)
    type EventHandler = (...args: unknown[]) => void;
    const eventHandlers: Record<string, EventHandler[]> = {};
    const mockProc = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: EventHandler) => {
        eventHandlers[event] ??= [];
        eventHandlers[event].push(cb);
      },
      kill: vi.fn(),
    };
    mockedSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

    const promise = execCommand("slow-cmd", [], { cwd: "/test", timeout: 1000 });
    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(1500);
    const result = await promise;

    expect(result.exitCode).toBe(-1);
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it("returns exitCode -1 and error message on process error", async () => {
    const mockProc = createMockProcess({
      stdoutData: [],
      stderrData: [],
      exitCode: null,
      error: new Error("spawn cmd ENOENT"),
    });
    mockedSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

    const promise = execCommand("nonexistent", [], { cwd: "/test", timeout: 5000 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toBe("spawn cmd ENOENT");
    expect(result.stdout).toBe("");
  });

  it("returns exitCode -1 when AbortSignal is triggered", async () => {
    type EventHandler = (...args: unknown[]) => void;
    const eventHandlers: Record<string, EventHandler[]> = {};
    const mockProc = {
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      on: (event: string, cb: EventHandler) => {
        eventHandlers[event] ??= [];
        eventHandlers[event].push(cb);
      },
      kill: vi.fn(),
    };
    mockedSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

    const controller = new AbortController();
    const promise = execCommand("cmd", [], {
      cwd: "/test",
      timeout: 5000,
      signal: controller.signal,
    });

    // Abort the signal
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.exitCode).toBe(-1);
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it("collects multiple stdout chunks", async () => {
    const mockProc = createMockProcess({
      stdoutData: [Buffer.from("chunk1"), Buffer.from("chunk2"), Buffer.from("chunk3")],
      stderrData: [],
      exitCode: 0,
    });
    mockedSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

    const promise = execCommand("cmd", [], { cwd: "/test", timeout: 5000 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.stdout).toBe("chunk1chunk2chunk3");
  });

  it("returns exitCode -1 when maxBuffer is exceeded", async () => {
    // Build a process that sends a massive chunk exceeding maxBuffer
    type EventHandler = (...args: unknown[]) => void;
    const eventHandlers: Record<string, EventHandler[]> = {};
    const mockProc = {
      stdout: {
        on: (event: string, cb: (data: Buffer) => void) => {
          if (event === "data") {
            // Send a chunk larger than maxBuffer (100 bytes)
            cb(Buffer.from("x".repeat(200)));
          }
        },
      },
      stderr: { on: () => {} },
      on: (event: string, cb: EventHandler) => {
        eventHandlers[event] ??= [];
        eventHandlers[event].push(cb);
      },
      kill: vi.fn(),
    };
    mockedSpawn.mockReturnValue(mockProc as unknown as ReturnType<typeof spawn>);

    const promise = execCommand("cmd", [], { cwd: "/test", timeout: 5000, maxBuffer: 100 });
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.exitCode).toBe(-1);
    expect(mockProc.kill).toHaveBeenCalled();
    // Output should be truncated to maxBuffer
    expect(result.stdout.length).toBeLessThanOrEqual(100);
  });
});
