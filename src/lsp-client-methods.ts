/**
 * LSP Client Methods - High-level LSP protocol method wrappers
 * Extends the base LspClient with typed methods for diagnostics operations
 *
 * Adapted from pi-lsp — only diagnostics-related methods are kept.
 */

import type { LspServerConfig } from "./types.js";
import type {
  InitializeParams,
  TextDocumentItem,
  DidChangeTextDocumentParams,
} from "./lsp-protocol.js";
import { LspClient as BaseLspClient } from "./lsp-client.js";

// ── Constants (method-level) ──────────────────────────────────────────────

/** Timeout for the initialize handshake (60 seconds) */
const INITIALIZE_TIMEOUT_MS = 60_000;
/** Timeout for graceful shutdown (5 seconds) */
const SHUTDOWN_TIMEOUT_MS = 5_000;
/** Timeout before force-killing after SIGTERM (3 seconds) */
const FORCE_KILL_DELAY_MS = 3_000;

// ── Extended Client ───────────────────────────────────────────────────────

export class LspClient extends BaseLspClient {
  /** Initialize the LSP connection */
  async initialize(config: LspServerConfig, rootUri: string | null): Promise<void> {
    const params: InitializeParams = {
      processId: globalThis.process.pid,
      clientInfo: { name: "pi-lens", version: "1.0.0" },
      rootUri,
      initializationOptions: config.initializationOptions,
      capabilities: {
        textDocument: {
          synchronization: { didSave: false },
          completion: { completionItem: { snippetSupport: false } },
          diagnostic: { dynamicRegistration: false },
        },
        workspace: {
          workspaceFolders: false,
          symbol: { dynamicRegistration: false },
        },
        window: { workDoneProgress: false },
      },
    };

    await this.request<Record<string, unknown>>("initialize", params, INITIALIZE_TIMEOUT_MS);

    // Send initialized notification
    this.notify("initialized", {});
    this.server.status = "running";
  }

  /** Open a text document */
  didOpen(uri: string, languageId: string, version: number, text: string): void {
    const item: TextDocumentItem = { uri, languageId, version, text };
    this.notify("textDocument/didOpen", { textDocument: item });
  }

  /** Notify document change */
  didChange(uri: string, version: number, text: string): void {
    const params: DidChangeTextDocumentParams = {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    };
    this.notify("textDocument/didChange", params);
  }

  /** Close a text document */
  didClose(uri: string): void {
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }

  /** Request diagnostics via pull model (LSP 3.17+) */
  async requestDiagnostics(uri: string): Promise<unknown> {
    return this.request("textDocument/diagnostic", { textDocument: { uri } }, 30_000);
  }

  /** Shutdown the LSP server gracefully */
  async shutdown(): Promise<void> {
    if (this.server.status !== "running") return;
    this.server.status = "stopping";

    try {
      await this.request("shutdown", {}, SHUTDOWN_TIMEOUT_MS);
      this.notify("exit", {});
    } catch {
      // Force kill if graceful shutdown fails
      const proc = this.process;
      if (proc) {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) {
            proc.kill("SIGKILL");
          }
        }, FORCE_KILL_DELAY_MS);
      }
    }

    this.server.status = "stopped";
    this.process = null;
    this.server.pid = null;
  }

  /** Force kill the server process */
  kill(): void {
    if (this.process) {
      this.process.kill("SIGKILL");
      this.process = null;
    }
    this.server.status = "stopped";
    this.server.pid = null;
  }

  /** Check if the process is still alive */
  isAlive(): boolean {
    if (!this.process) return false;
    return !this.process.killed;
  }
}
