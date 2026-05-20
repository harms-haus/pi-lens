import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Mock all internal modules
vi.mock("@harms-haus/code-lens/client", () => ({
  ensureDaemon: vi.fn().mockResolvedValue(undefined),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
  getSocketPath: vi.fn().mockReturnValue("/tmp/code-lens-test.sock"),
  sendRequest: vi.fn(),
}));

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(),
  DEFAULT_CONFIG: {
    prettier: true,
    linters: true,
    lsp: true,
    tsc: true,
    includePatterns: [],
    excludePatterns: ["node_modules/**", ".git/**"],
    lspDelayMs: 1000,
    maxConcurrency: 4,
    prettierTimeoutMs: 15_000,
    linterTimeoutMs: 15_000,
    tscTimeoutMs: 30_000,
    bashDetection: true,
    alwaysReport: true,
  },
}));

vi.mock("../hook-runner.js", () => ({
  resolveFilesFromToolResult: vi.fn(),
  runChecks: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

import { loadConfig, DEFAULT_CONFIG } from "../config.js";
import { resolveFilesFromToolResult, runChecks } from "../hook-runner.js";
import { ensureDaemon, stopDaemon } from "@harms-haus/code-lens/client";

// Import the extension after mocks are set up
import extension from "../index.js";

function createMockPi(): {
  pi: ExtensionAPI;
  handlers: Map<string, (...args: unknown[]) => unknown>;
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    }),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    getFlag: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
    sendUserMessage: vi.fn(),
    appendEntry: vi.fn(),
    setSessionName: vi.fn(),
    getSessionName: vi.fn(),
    setLabel: vi.fn(),
    exec: vi.fn(),
    getActiveTools: vi.fn(),
    getAllTools: vi.fn(),
    setActiveTools: vi.fn(),
    getCommands: vi.fn(),
    setModel: vi.fn(),
    getThinkingLevel: vi.fn(),
    setThinkingLevel: vi.fn(),
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

function createMockContext(overrides?: Partial<ExtensionContext>): ExtensionContext {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      select: vi.fn(),
      confirm: vi.fn(),
      input: vi.fn(),
      onTerminalInput: vi.fn(),
      setWorkingMessage: vi.fn(),
      setWorkingVisible: vi.fn(),
      setWorkingIndicator: vi.fn(),
      setHiddenThinkingLabel: vi.fn(),
      setWidget: vi.fn(),
      setFooter: vi.fn(),
      setHeader: vi.fn(),
      setTitle: vi.fn(),
      custom: vi.fn(),
      pasteToEditor: vi.fn(),
      setEditorText: vi.fn(),
      getEditorText: vi.fn(),
      editor: vi.fn(),
      addAutocompleteProvider: vi.fn(),
      setEditorComponent: vi.fn(),
      getEditorComponent: vi.fn(),
      theme: {} as never,
      getAllThemes: vi.fn(),
      getTheme: vi.fn(),
      setTheme: vi.fn(),
      getToolsExpanded: vi.fn(),
      setToolsExpanded: vi.fn(),
    },
    hasUI: true,
    cwd: "/home/user/project",
    sessionManager: {} as never,
    modelRegistry: {} as never,
    model: undefined,
    isIdle: vi.fn(),
    signal: undefined,
    abort: vi.fn(),
    hasPendingMessages: vi.fn(),
    shutdown: vi.fn(),
    getContextUsage: vi.fn(),
    compact: vi.fn(),
    getSystemPrompt: vi.fn(),
    ...overrides,
  } as unknown as ExtensionContext;
}

// ── Subagent test helpers ──────────────────────────────────────────

function createToolActivityPartialResult() {
  return {
    details: {
      windows: [
        {
          lines: [{ kind: "tool", content: "write file.ts" }],
        },
      ],
    },
  };
}

function createNoActivityPartialResult() {
  return {
    details: {
      windows: [
        {
          lines: [{ kind: "text", content: "thinking..." }],
        },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadConfig).mockReturnValue({ ...DEFAULT_CONFIG });
});

// ── Extension loading ───────────────────────────────────────────────

describe("extension entry point", () => {
  it("default export is a function", () => {
    expect(typeof extension).toBe("function");
  });

  it("registers session_start, session_shutdown, and tool_result handlers", () => {
    const { pi } = createMockPi();
    extension(pi);
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
  });
});

// ── session_start ───────────────────────────────────────────────────

describe("session_start", () => {
  it("initializes state and starts daemon", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const handler = handlers.get("session_start");
    expect(handler).toBeDefined();
    await handler!({ type: "session_start", reason: "startup" }, ctx);

    expect(loadConfig).toHaveBeenCalledWith("/home/user/project");
    expect(ensureDaemon).toHaveBeenCalledWith("/home/user/project");
  });

  it("notifies UI with ready message", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const handler = handlers.get("session_start")!;
    await handler({ type: "session_start", reason: "startup" }, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("ready"), "info");
  });

  it("publishes initial status", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const handler = handlers.get("session_start")!;
    await handler({ type: "session_start", reason: "startup" }, ctx);

    expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-lens", expect.any(String));
  });

  it("works without UI (hasUI: false)", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext({ hasUI: false } as Partial<ExtensionContext>);
    extension(pi);

    const handler = handlers.get("session_start")!;
    // Should not throw
    await handler({ type: "session_start", reason: "startup" }, ctx);
  });

  it("does not call setStatus when hasUI is false", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext({ hasUI: false } as Partial<ExtensionContext>);
    extension(pi);
    const handler = handlers.get("session_start")!;
    await handler({ type: "session_start", reason: "startup" }, ctx);
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("deduplicates identical status payloads", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    // Count calls after initial session_start (which already calls publishStatus once)
    const initialCallCount = vi.mocked(ctx.ui.setStatus).mock.calls.length;

    // publishStatus is private, so we trigger it indirectly via tool_result with same statuses
    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/src/foo.ts"]);
    vi.mocked(runChecks).mockResolvedValue({
      text: "clean",
      statuses: { prettier: "pending", linters: "pending", lsp: "pending", tsc: "pending" },
      durationMs: 10,
    });

    const toolResultHandler = handlers.get("tool_result")!;

    // First call — same status as initial (pending,pending,pending,pending) → should be deduped
    await toolResultHandler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call-dedup-1",
        input: { path: "/home/user/project/src/foo.ts" },
        content: [{ type: "text", text: "File written" }],
        isError: false,
      },
      ctx,
    );

    // No additional setStatus calls because payload is identical to initial
    expect(vi.mocked(ctx.ui.setStatus).mock.calls.length).toBe(initialCallCount);
  });
});

// ── session_shutdown ────────────────────────────────────────────────

describe("session_shutdown", () => {
  it("stops daemon and clears state", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    // First start session
    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    // Then shutdown
    const shutdownHandler = handlers.get("session_shutdown")!;
    await shutdownHandler({ type: "session_shutdown", reason: "quit" }, ctx);

    expect(stopDaemon).toHaveBeenCalledWith("/home/user/project");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("pi-lens", undefined);
  });
});

// ── tool_result hook ────────────────────────────────────────────────

describe("tool_result hook", () => {
  it("triggers checks for write tool", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    // Start session first
    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/src/foo.ts"]);
    vi.mocked(runChecks).mockResolvedValue({
      text: "🔍 pi-lens: 1 file(s) checked — all clean (100ms)",
      statuses: {
        prettier: "clean",
        linters: "skipped",
        lsp: "skipped",
        tsc: "skipped",
      },
      durationMs: 100,
    });

    const toolResultHandler = handlers.get("tool_result")!;
    const event = {
      type: "tool_result" as const,
      toolName: "write",
      toolCallId: "call-1",
      input: { path: "/home/user/project/src/foo.ts" },
      content: [{ type: "text" as const, text: "File written" }],
      isError: false,
    };

    const result = await toolResultHandler(event, ctx);

    expect(resolveFilesFromToolResult).toHaveBeenCalledWith(
      "write",
      event.input,
      "/home/user/project",
      expect.objectContaining({ bashDetection: true }),
    );
    expect(runChecks).toHaveBeenCalled();
    expect(result).toEqual({
      content: [
        { type: "text", text: "File written" },
        { type: "text", text: "🔍 pi-lens: 1 file(s) checked — all clean (100ms)" },
      ],
    });
  });

  it("triggers checks for edit tool", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/src/foo.ts"]);
    vi.mocked(runChecks).mockResolvedValue({
      text: "🔍 pi-lens: 1 file(s) checked — all clean (50ms)",
      statuses: { prettier: "clean", linters: "skipped", lsp: "skipped", tsc: "skipped" },
      durationMs: 50,
    });

    const toolResultHandler = handlers.get("tool_result")!;
    await toolResultHandler(
      {
        type: "tool_result",
        toolName: "edit",
        toolCallId: "call-2",
        input: { path: "/home/user/project/src/foo.ts" },
        content: [{ type: "text", text: "File edited" }],
        isError: false,
      },
      ctx,
    );

    expect(resolveFilesFromToolResult).toHaveBeenCalledWith(
      "edit",
      expect.any(Object),
      "/home/user/project",
      expect.objectContaining({ bashDetection: true }),
    );
  });

  it("triggers checks for bash tool", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/output.txt"]);
    vi.mocked(runChecks).mockResolvedValue({
      text: "🔍 pi-lens: 1 file(s) checked — all clean (30ms)",
      statuses: { prettier: "clean", linters: "skipped", lsp: "skipped", tsc: "skipped" },
      durationMs: 30,
    });

    const toolResultHandler = handlers.get("tool_result")!;
    await toolResultHandler(
      {
        type: "tool_result",
        toolName: "bash",
        toolCallId: "call-3",
        input: { command: "sed -i 's/a/b/g' output.txt" },
        content: [{ type: "text", text: "command ran" }],
        isError: false,
      },
      ctx,
    );

    expect(resolveFilesFromToolResult).toHaveBeenCalledWith(
      "bash",
      expect.any(Object),
      "/home/user/project",
      expect.objectContaining({ bashDetection: true }),
    );
  });

  it("ignores other tools (read, grep, find, ls)", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const toolResultHandler = handlers.get("tool_result")!;

    for (const toolName of ["read", "grep", "find", "ls"]) {
      const result = await toolResultHandler(
        {
          type: "tool_result",
          toolName,
          toolCallId: "call-x",
          input: {},
          content: [{ type: "text", text: "result" }],
          isError: false,
        },
        ctx,
      );
      expect(result).toBeUndefined();
    }
    expect(resolveFilesFromToolResult).not.toHaveBeenCalled();
  });

  it("skips error results", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const toolResultHandler = handlers.get("tool_result")!;
    const result = await toolResultHandler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call-err",
        input: { path: "/home/user/project/src/foo.ts" },
        content: [{ type: "text", text: "Error: file not found" }],
        isError: true,
      },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(resolveFilesFromToolResult).not.toHaveBeenCalled();
  });

  it("returns undefined when no files resolved", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue([]);

    const toolResultHandler = handlers.get("tool_result")!;
    const result = await toolResultHandler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call-empty",
        input: { path: "/nonexistent/file.txt" },
        content: [{ type: "text", text: "done" }],
        isError: false,
      },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("returns appended content with check results", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/src/foo.ts"]);
    vi.mocked(runChecks).mockResolvedValue({
      text: "🔍 pi-lens: 1 file(s) checked\n  ⚠ tsc: 1 error(s)",
      statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "issues" },
      durationMs: 200,
    });

    const toolResultHandler = handlers.get("tool_result")!;
    const result = await toolResultHandler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call-4",
        input: { path: "/home/user/project/src/foo.ts" },
        content: [{ type: "text", text: "File written" }],
        isError: false,
      },
      ctx,
    );

    const returned = result as { content: Array<{ type: string; text: string }> };
    expect(returned.content).toHaveLength(2);
    expect(returned.content[0]!.text).toBe("File written");
    expect(returned.content[1]!.text).toContain("tsc");
  });

  it("swallows errors from runChecks (never blocks tool result)", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/src/foo.ts"]);
    vi.mocked(runChecks).mockRejectedValue(new Error("check exploded"));

    // Should NOT throw and should not block
    const toolResultHandler = handlers.get("tool_result")!;
    const swallowedResult = await toolResultHandler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call-crash",
        input: { path: "/home/user/project/src/foo.ts" },
        content: [{ type: "text", text: "File written" }],
        isError: false,
      },
      ctx,
    );

    expect(swallowedResult).toBeUndefined();
  });

  it("returns undefined when runChecks returns empty text", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/src/foo.ts"]);
    vi.mocked(runChecks).mockResolvedValue({
      text: "",
      statuses: { prettier: "skipped", linters: "skipped", lsp: "skipped", tsc: "skipped" },
      durationMs: 10,
    });

    const toolResultHandler = handlers.get("tool_result")!;
    const result = await toolResultHandler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call-no-text",
        input: { path: "/home/user/project/src/foo.ts" },
        content: [{ type: "text", text: "File written" }],
        isError: false,
      },
      ctx,
    );

    expect(result).toBeUndefined();
  });

  it("publishes correct status with check results", async () => {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(resolveFilesFromToolResult).mockReturnValue(["/home/user/project/src/foo.ts"]);
    vi.mocked(runChecks).mockResolvedValue({
      text: "issues found",
      statuses: {
        prettier: "clean",
        linters: "clean",
        lsp: "clean",
        tsc: "issues",
      },
      durationMs: 100,
    });

    const toolResultHandler = handlers.get("tool_result")!;
    await toolResultHandler(
      {
        type: "tool_result",
        toolName: "write",
        toolCallId: "call-all-tools",
        input: { path: "/home/user/project/src/foo.ts" },
        content: [{ type: "text", text: "File written" }],
        isError: false,
      },
      ctx,
    );

    // Find the last setStatus call (the one from publishStatus with check results)
    const allCalls = vi
      .mocked(ctx.ui.setStatus)
      .mock.calls.filter((call) => call[0] === "pi-lens" && call[1] !== undefined);
    expect(allCalls.length).toBeGreaterThanOrEqual(2);
    const lastCall = allCalls[allCalls.length - 1]!;
    const status = JSON.parse(lastCall[1] as string);
    expect(status.prettier).toBe("clean");
    expect(status.linters).toBe("clean");
    expect(status.lsp).toBe("clean");
    expect(status.tsc).toBe("issues");
  });
});

// ── Handler registration for subagent monitoring ──────────────────────

describe("subagent handler registration", () => {
  it("registers tool_execution_update handler", () => {
    const { pi } = createMockPi();
    extension(pi);
    expect(pi.on).toHaveBeenCalledWith("tool_execution_update", expect.any(Function));
  });

  it("registers tool_execution_end handler", () => {
    const { pi } = createMockPi();
    extension(pi);
    expect(pi.on).toHaveBeenCalledWith("tool_execution_end", expect.any(Function));
  });
});

// ── tool_execution_update filtering ──────────────────────────────────

describe("tool_execution_update filtering", () => {
  it("ignores non-delegate_to_subagents tools", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi);

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "write",
      toolCallId: "call-filter-1",
      partialResult: createToolActivityPartialResult(),
    });

    expect(pi.exec).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("ignores delegate_to_subagents with no tool activity", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi);

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-filter-2",
      partialResult: createNoActivityPartialResult(),
    });

    expect(pi.exec).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("ignores delegate_to_subagents with null partialResult", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi);

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-filter-3",
      partialResult: null,
    });

    expect(pi.exec).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("ignores delegate_to_subagents with empty windows", async () => {
    const { pi, handlers } = createMockPi();
    extension(pi);

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-filter-4",
      partialResult: { details: { windows: [] } },
    });

    expect(pi.exec).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("ignores delegate_to_subagents when windows is not an array", () => {
    const { pi, handlers } = createMockPi();
    extension(pi);

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-non-array-windows",
      partialResult: { details: { windows: "not-an-array" } },
    });

    expect(pi.exec).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("ignores delegate_to_subagents when window lines is not an array", () => {
    const { pi, handlers } = createMockPi();
    extension(pi);

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-non-array-lines",
      partialResult: { details: { windows: [{ lines: "not-an-array" }] } },
    });

    expect(pi.exec).not.toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });
});

// ── tool_execution_update triggers check ─────────────────────────────

describe("tool_execution_update triggers check", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupSessionAndMocks() {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(pi.exec).mockResolvedValue({
      code: 0,
      stdout: "src/foo.ts\nsrc/bar.ts",
      stderr: "",
      killed: false,
    });
    vi.mocked(runChecks).mockResolvedValue({
      text: "clean",
      statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" },
      durationMs: 50,
    });

    return { pi, handlers, ctx };
  }

  it("triggers immediate check when cooldown elapsed", async () => {
    const { pi, handlers } = await setupSessionAndMocks();

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-trigger-1",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.runAllTimersAsync();

    expect(pi.exec).toHaveBeenCalledWith(
      "git",
      ["diff", "--name-only", "HEAD"],
      expect.objectContaining({ cwd: "/home/user/project", timeout: 5000 }),
    );
    expect(runChecks).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.stringContaining("src/foo.ts"),
        expect.stringContaining("src/bar.ts"),
      ]),
      "/home/user/project",
      expect.objectContaining({ bashDetection: true }),
    );
  });

  it("triggers check on tool_execution_end for delegate_to_subagents", async () => {
    const { handlers } = await setupSessionAndMocks();

    const handler = handlers.get("tool_execution_end")!;
    handler({
      type: "tool_execution_end",
      toolName: "delegate_to_subagents",
      toolCallId: "call-end-1",
    });

    await vi.runAllTimersAsync();

    expect(runChecks).toHaveBeenCalled();
  });

  it("ignores tool_execution_end for non-delegate tools", async () => {
    const { handlers } = await setupSessionAndMocks();

    const handler = handlers.get("tool_execution_end")!;
    handler({
      type: "tool_execution_end",
      toolName: "write",
      toolCallId: "call-end-2",
    });

    await vi.runAllTimersAsync();

    expect(handlers.get("tool_execution_end")).toBeDefined();
    expect(runChecks).not.toHaveBeenCalled();
  });
});

// ── Git error paths ────────────────────────────────────────────────────

describe("git error paths in subagent checker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupSession() {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    return { pi, handlers, ctx };
  }

  it("handles git returning non-zero exit code", async () => {
    const { pi, handlers } = await setupSession();
    vi.mocked(pi.exec).mockResolvedValue({
      code: 128,
      stdout: "",
      stderr: "fatal: not a git repo",
      killed: false,
    });
    vi.mocked(runChecks).mockResolvedValue({
      text: "",
      statuses: { prettier: "skipped", linters: "skipped", lsp: "skipped", tsc: "skipped" },
      durationMs: 10,
    });

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-git-err",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.runAllTimersAsync();

    expect(pi.exec).toHaveBeenCalled();
    // runChecks should NOT be called because no files were resolved
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("handles git returning empty stdout", async () => {
    const { pi, handlers } = await setupSession();
    vi.mocked(pi.exec).mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      killed: false,
    });

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-git-empty",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.runAllTimersAsync();

    expect(pi.exec).toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });

  it("handles git command throwing", async () => {
    const { pi, handlers } = await setupSession();
    vi.mocked(pi.exec).mockRejectedValue(new Error("git not found"));

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-git-throw",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.runAllTimersAsync();

    expect(pi.exec).toHaveBeenCalled();
    expect(runChecks).not.toHaveBeenCalled();
  });
});

// ── Subagent checker internal paths ────────────────────────────────────

describe("subagent checker internal paths", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupSession() {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    return { pi, handlers, ctx };
  }

  it("handles runChecks throwing in subagent checker", async () => {
    const { pi, handlers } = await setupSession();
    vi.mocked(pi.exec).mockResolvedValue({
      code: 0,
      stdout: "src/foo.ts",
      stderr: "",
      killed: false,
    });
    vi.mocked(runChecks).mockRejectedValue(new Error("check exploded"));

    const handler = handlers.get("tool_execution_update")!;
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-subagent-throw",
      partialResult: createToolActivityPartialResult(),
    });

    // Should not throw
    await vi.runAllTimersAsync();

    expect(runChecks).toHaveBeenCalledTimes(1);
  });

  it("aborts check when shutdown happens mid-flight", async () => {
    const { pi, handlers, ctx } = await setupSession();

    // Make runChecks hang until we advance timers
    let resolveChecks!: () => void;
    const checksPromise = new Promise<void>((resolve) => {
      resolveChecks = resolve;
    });
    vi.mocked(pi.exec).mockResolvedValue({
      code: 0,
      stdout: "src/foo.ts",
      stderr: "",
      killed: false,
    });
    vi.mocked(runChecks).mockImplementation(() => {
      return checksPromise.then(() => ({
        text: "clean",
        statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" },
        durationMs: 10,
      }));
    });

    const updateHandler = handlers.get("tool_execution_update")!;
    updateHandler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-shutdown-mid",
      partialResult: createToolActivityPartialResult(),
    });

    // Let git resolve but keep runChecks pending
    await vi.advanceTimersByTimeAsync(100);

    // Now shutdown while check is still in-flight
    const shutdownHandler = handlers.get("session_shutdown")!;
    await shutdownHandler({ type: "session_shutdown", reason: "quit" }, ctx);

    // Now resolve runChecks
    resolveChecks();
    await vi.runAllTimersAsync();

    // The status update after shutdown should be suppressed
    // (publishStatus checks currentCtx?.hasUI which is undefined after shutdown)
    // No additional setStatus with check results should happen
    const statusCalls = vi
      .mocked(ctx.ui.setStatus)
      .mock.calls.filter((c) => c[0] === "pi-lens" && c[1] !== undefined);
    // Only the initial session_start status was set
    expect(statusCalls.length).toBe(1);
  });

  it("processes pending check after files.length === 0 early return", async () => {
    const { pi, handlers } = await setupSession();

    // First call: git returns no files → early return
    vi.mocked(pi.exec).mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: "",
      killed: false,
    });

    // But we need a second git call for the pending check to resolve files
    vi.mocked(pi.exec).mockResolvedValueOnce({
      code: 0,
      stdout: "src/foo.ts",
      stderr: "",
      killed: false,
    });

    vi.mocked(runChecks).mockResolvedValue({
      text: "clean",
      statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" },
      durationMs: 10,
    });

    const handler = handlers.get("tool_execution_update")!;

    // First trigger — immediate check, no files
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-empty-1",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(runChecks).not.toHaveBeenCalled();

    // Rapid second trigger during cooldown — marks pending
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-empty-2",
      partialResult: createToolActivityPartialResult(),
    });

    // Advance past cooldown — pending check should fire with files
    await vi.advanceTimersByTimeAsync(6000);

    expect(runChecks).toHaveBeenCalledTimes(1);
  });
});

// ── Cooldown enforcement ─────────────────────────────────────────────

describe("cooldown enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupSessionAndMocks() {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(pi.exec).mockResolvedValue({
      code: 0,
      stdout: "src/foo.ts",
      stderr: "",
      killed: false,
    });
    vi.mocked(runChecks).mockResolvedValue({
      text: "clean",
      statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" },
      durationMs: 50,
    });

    return { pi, handlers, ctx };
  }

  it("enforces 5-second cooldown between checks", async () => {
    const { handlers } = await setupSessionAndMocks();

    const handler = handlers.get("tool_execution_update")!;

    // First update triggers immediate check (lastCheckTime is 0 → cooldown elapsed)
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-cd-1",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.runAllTimersAsync();
    expect(runChecks).toHaveBeenCalledTimes(1);

    // Advance by 2 seconds (within cooldown)
    await vi.advanceTimersByTimeAsync(2000);

    // Second update — cooldown NOT elapsed, should schedule a pending check
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-cd-2",
      partialResult: createToolActivityPartialResult(),
    });

    // No additional check should have run yet
    expect(runChecks).toHaveBeenCalledTimes(1);

    // Advance remaining time to pass 5-second cooldown
    await vi.advanceTimersByTimeAsync(3500);

    // Now the pending check should have fired
    expect(runChecks).toHaveBeenCalledTimes(2);
  });

  it("collapses multiple pending requests into one", async () => {
    const { handlers } = await setupSessionAndMocks();

    const handler = handlers.get("tool_execution_update")!;

    // First update triggers immediate check
    handler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-collapse-1",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.runAllTimersAsync();
    expect(runChecks).toHaveBeenCalledTimes(1);

    // Advance slightly into cooldown
    await vi.advanceTimersByTimeAsync(1000);

    // Fire 3 rapid updates during cooldown — all should be coalesced
    for (let i = 0; i < 3; i++) {
      handler({
        type: "tool_execution_update",
        toolName: "delegate_to_subagents",
        toolCallId: `call-collapse-rapid-${i}`,
        partialResult: createToolActivityPartialResult(),
      });
    }

    // Still only the original check
    expect(runChecks).toHaveBeenCalledTimes(1);

    // Advance past cooldown
    await vi.advanceTimersByTimeAsync(5000);

    // Only one additional check should have run (3 requests coalesced into 1)
    expect(runChecks).toHaveBeenCalledTimes(2);
  });
});

// ── Session lifecycle for subagent checker ───────────────────────────

describe("subagent session lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function setupSessionAndMocks() {
    const { pi, handlers } = createMockPi();
    const ctx = createMockContext();
    extension(pi);

    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    vi.mocked(pi.exec).mockResolvedValue({
      code: 0,
      stdout: "src/foo.ts",
      stderr: "",
      killed: false,
    });
    vi.mocked(runChecks).mockResolvedValue({
      text: "clean",
      statuses: { prettier: "clean", linters: "clean", lsp: "clean", tsc: "clean" },
      durationMs: 50,
    });

    return { pi, handlers, ctx };
  }

  it("clears timer on session_shutdown", async () => {
    const { handlers, ctx } = await setupSessionAndMocks();

    const updateHandler = handlers.get("tool_execution_update")!;

    // Trigger first check
    updateHandler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-lifecycle-1",
      partialResult: createToolActivityPartialResult(),
    });
    await vi.runAllTimersAsync();
    expect(runChecks).toHaveBeenCalledTimes(1);

    // Advance into cooldown and trigger a pending check
    await vi.advanceTimersByTimeAsync(1000);
    updateHandler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-lifecycle-2",
      partialResult: createToolActivityPartialResult(),
    });

    // Shutdown — should clear the pending timer
    const shutdownHandler = handlers.get("session_shutdown")!;
    await shutdownHandler({ type: "session_shutdown", reason: "quit" }, ctx);

    // Clear runChecks mock to verify no further calls
    vi.mocked(runChecks).mockClear();

    // Advance well past cooldown — no additional check should fire
    await vi.advanceTimersByTimeAsync(10_000);

    expect(runChecks).not.toHaveBeenCalled();
  });

  it("resets state on session_start", async () => {
    const { pi, handlers, ctx } = await setupSessionAndMocks();

    const updateHandler = handlers.get("tool_execution_update")!;

    // Trigger a check in the first session
    updateHandler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-reset-1",
      partialResult: createToolActivityPartialResult(),
    });
    await vi.runAllTimersAsync();
    expect(runChecks).toHaveBeenCalledTimes(1);

    // Start a new session — resets checker state (cooldown reset)
    const startHandler = handlers.get("session_start")!;
    await startHandler({ type: "session_start", reason: "startup" }, ctx);

    // Re-apply mocks since session_start triggers loadConfig
    vi.mocked(pi.exec).mockResolvedValue({
      code: 0,
      stdout: "src/baz.ts",
      stderr: "",
      killed: false,
    });
    vi.mocked(runChecks).mockClear();

    // Should be able to trigger an immediate check again (cooldown was reset)
    updateHandler({
      type: "tool_execution_update",
      toolName: "delegate_to_subagents",
      toolCallId: "call-reset-2",
      partialResult: createToolActivityPartialResult(),
    });

    await vi.runAllTimersAsync();

    expect(runChecks).toHaveBeenCalledTimes(1);
  });
});
