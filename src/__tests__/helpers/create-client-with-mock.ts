import { vi } from "vitest";
import { EventEmitter } from "node:events";
import * as child_process from "node:child_process";
import { LspClient } from "../../lsp-client-methods.js";
import { createTestServerInstance, TEST_TS_CONFIG } from "./fixtures.js";
import type { LspServerConfig } from "../../types.js";

/**
 * Creates an LspClient wired to a mock child process.
 *
 * The harness intercepts child_process.spawn (already mocked globally in setup.ts)
 * and returns a fully-controllable mock process.  Tests can:
 *   - inspect messages the client sends via getSentMessages()
 *   - simulate server responses via sendToClient()
 *   - auto-respond to initialize/shutdown via autoRespond()
 *
 * Usage:
 *   const h = createClientWithMock();
 *   h.autoRespond();
 *   await h.client.startProcess(h.config);
 *   await h.client.initialize(h.config, "file:///tmp");
 *   // ... exercise client, inspect h.getSentMessages(), etc.
 */
export function createClientWithMock(config: LspServerConfig = TEST_TS_CONFIG) {
  const server = createTestServerInstance(config);
  const notifications: { method: string; params: unknown }[] = [];
  const onNotification = vi.fn((method: string, params: unknown) => {
    notifications.push({ method, params });
  });

  // ── Mock child process ─────────────────────────────────────────────────
  const mockProcess: any = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const stdinWrites: string[] = [];

  mockProcess.stdout = stdoutEmitter;
  mockProcess.stderr = stderrEmitter;
  mockProcess.stdin = {
    write: vi.fn((data: string) => {
      stdinWrites.push(data);
    }),
  };
  mockProcess.pid = 12345;
  mockProcess.killed = false;
  mockProcess.kill = vi.fn();

  // Wire spawn mock to return our mock process
  (child_process.spawn as ReturnType<typeof vi.fn>).mockReturnValue(mockProcess);

  // ── Create the real client ─────────────────────────────────────────────
  const client = new LspClient(server, onNotification);

  // ── Helpers ────────────────────────────────────────────────────────────

  /** Parse all messages the client has sent via stdin */
  function getSentMessages() {
    return stdinWrites
      .map((w) => {
        const body = w.split("\r\n\r\n").slice(1).join("\r\n\r\n");
        try {
          return JSON.parse(body);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  /** Simulate the server sending a JSON-RPC message to the client */
  function sendToClient(msg: {
    jsonrpc: "2.0";
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
  }) {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    stdoutEmitter.emit("data", Buffer.from(header + body));
  }

  /**
   * Patch stdin.write so the mock process auto-responds to:
   *   - "initialize" → returns { capabilities: {} }
   *   - "shutdown"   → returns null
   *
   * Call this BEFORE client.startProcess() so the patched write is in place
   * when the client sends initialize/shutdown messages.
   */
  function autoRespond() {
    mockProcess.stdin = {
      write: vi.fn((data: string) => {
        stdinWrites.push(data);
        try {
          const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
          const msg = JSON.parse(body);
          if (msg.method === "initialize") {
            sendToClient({ jsonrpc: "2.0", id: msg.id, result: { capabilities: {} } });
          } else if (msg.method === "shutdown") {
            sendToClient({ jsonrpc: "2.0", id: msg.id, result: null });
          }
        } catch {
          /* ignore non-JSON data */
        }
      }) as unknown as NodeJS.WritableStream["write"],
    } as unknown as NodeJS.WritableStream;
  }

  /** Emit the 'error' event on the mock process */
  function emitError(err: Error) {
    mockProcess.emit("error", err);
  }

  /** Emit the 'exit' event on the mock process */
  function emitExit(code: number | null, signal: NodeJS.Signals | null) {
    mockProcess.emit("exit", code, signal);
  }

  return {
    client,
    server,
    mockProcess,
    stdoutEmitter,
    stderrEmitter,
    stdinWrites,
    getSentMessages,
    sendToClient,
    autoRespond,
    emitError,
    emitExit,
    onNotification,
    notifications,
    config,
  };
}

export type MockClientHarness = ReturnType<typeof createClientWithMock>;
