import { describe, it, expect, vi, beforeEach } from "vitest";
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
