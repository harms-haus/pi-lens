import { describe, it, expect, beforeEach, vi } from "vitest";
import { createClientWithMock } from "./helpers/create-client-with-mock.js";
import type { MockClientHarness } from "./helpers/create-client-with-mock.js";

describe("LspClient Methods", () => {
  let h: MockClientHarness;

  beforeEach(() => {
    h = createClientWithMock();
  });

  /**
   * Helper: start the process and initialize so the client is in "running" state.
   */
  async function startAndInitialize(rootUri: string | null = "file:///tmp") {
    h.autoRespond();
    await h.client.startProcess(h.config);
    await h.client.initialize(h.config, rootUri);
  }

  /**
   * Helper: intercept the last sent JSON-RPC request message, respond to it,
   * and return the intercepted message for assertions.
   */
  function interceptAndRespond(method: string, result: unknown) {
    const msgs = h.getSentMessages();
    const req = msgs.find((m: any) => m.method === method);
    if (!req) {
      const methods = msgs.map((m: any) => m.method);
      throw new Error(
        `No message with method "${method}" was sent. Messages: ${JSON.stringify(methods)}`,
      );
    }
    h.sendToClient({ jsonrpc: "2.0", id: req.id, result });
    return req;
  }

  /**
   * Helper: find a sent message by method name.
   */
  function findSentMessage(method: string) {
    return h.getSentMessages().find((m: any) => m.method === method);
  }

  // ─── Request-based methods ─────────────────────────────────────────────

  describe("Request-based methods", () => {
    beforeEach(async () => {
      await startAndInitialize();
    });

    it("initialize should send initialize request and initialized notification, then set status to running", () => {
      const msgs = h.getSentMessages();
      const initReq = msgs.find((m: any) => m.method === "initialize");
      expect(initReq).toBeDefined();
      expect((initReq as any).params).toMatchObject({
        processId: expect.any(Number),
        rootUri: "file:///tmp",
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
      });

      const initNotif = msgs.find((m: any) => m.method === "initialized");
      expect(initNotif).toBeDefined();
      expect((initNotif as any).params).toEqual({});

      expect(h.server.status).toBe("running");
    });

    it("requestDiagnostics should send textDocument/diagnostic with textDocument.uri", async () => {
      const promise = h.client.requestDiagnostics("file:///test.ts");
      const req = interceptAndRespond("textDocument/diagnostic", {
        kind: "full",
        items: [],
      });
      expect((req as any).params).toEqual({ textDocument: { uri: "file:///test.ts" } });
      const result = await promise;
      expect(result).toBeDefined();
    });
  });

  // ─── Notification-based methods ────────────────────────────────────────

  describe("Notification-based methods", () => {
    beforeEach(async () => {
      await startAndInitialize();
    });

    it("didOpen should send textDocument/didOpen notification", () => {
      h.client.didOpen("file:///test.ts", "typescript", 1, "const x = 1;");
      const notif = findSentMessage("textDocument/didOpen");
      expect(notif).toBeDefined();
      expect((notif as any).id).toBeUndefined();
      expect((notif as any).params).toEqual({
        textDocument: {
          uri: "file:///test.ts",
          languageId: "typescript",
          version: 1,
          text: "const x = 1;",
        },
      });
    });

    it("didChange should send textDocument/didChange notification", () => {
      h.client.didChange("file:///test.ts", 2, "const y = 2;");
      const notif = findSentMessage("textDocument/didChange");
      expect(notif).toBeDefined();
      expect((notif as any).id).toBeUndefined();
      expect((notif as any).params).toEqual({
        textDocument: { uri: "file:///test.ts", version: 2 },
        contentChanges: [{ text: "const y = 2;" }],
      });
    });

    it("didClose should send textDocument/didClose notification", () => {
      h.client.didClose("file:///test.ts");
      const notif = findSentMessage("textDocument/didClose");
      expect(notif).toBeDefined();
      expect((notif as any).id).toBeUndefined();
      expect((notif as any).params).toEqual({
        textDocument: { uri: "file:///test.ts" },
      });
    });
  });

  // ─── Lifecycle methods ─────────────────────────────────────────────────

  describe("Lifecycle methods", () => {
    it("shutdown should send shutdown request and exit notification, then set status to stopped", async () => {
      await startAndInitialize();
      expect(h.server.status).toBe("running");

      await h.client.shutdown();

      const msgs = h.getSentMessages();
      const shutdownReq = msgs.find((m: any) => m.method === "shutdown");
      expect(shutdownReq).toBeDefined();
      expect((shutdownReq as any).id).toBeDefined();

      const exitNotif = msgs.find((m: any) => m.method === "exit");
      expect(exitNotif).toBeDefined();
      expect((exitNotif as any).id).toBeUndefined();
      expect((exitNotif as any).params).toEqual({});

      expect(h.server.status).toBe("stopped");
      expect((h.client as any).process).toBeNull();
      expect(h.server.pid).toBeNull();
    });

    it("shutdown should force-kill process when graceful shutdown fails", async () => {
      await startAndInitialize();
      expect(h.server.status).toBe("running");

      // Make the mock respond to shutdown with an error
      const writeFn = (h.mockProcess as any).stdin as { write: ReturnType<typeof vi.fn> };
      writeFn.write = vi.fn((data: string) => {
        try {
          const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
          const msg = JSON.parse(body);
          if (msg.method === "shutdown") {
            // Don't respond — let it timeout or we send an error
            h.sendToClient({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32603, message: "Internal error" },
            });
          }
        } catch {
          /* ignore */
        }
      }) as any;

      await h.client.shutdown();

      expect(h.mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
      expect(h.server.status).toBe("stopped");
    });

    it("shutdown handles error when process is null", async () => {
      await startAndInitialize();
      // Set process to null after starting
      (h.client as any).process = null;
      h.server.status = "running";

      const writeFn = (h.mockProcess as any).stdin as { write: ReturnType<typeof vi.fn> };
      writeFn.write = vi.fn((data: string) => {
        try {
          const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
          const msg = JSON.parse(body);
          if (msg.method === "shutdown") {
            h.sendToClient({
              jsonrpc: "2.0",
              id: msg.id,
              error: { code: -32603, message: "Internal error" },
            });
          }
        } catch {
          /* ignore */
        }
      }) as any;

      await h.client.shutdown();
      expect(h.server.status).toBe("stopped");
    });

    it("shutdown should not send anything if status is not running", async () => {
      const msgsBefore = h.getSentMessages().length;
      await h.client.shutdown();
      const msgsAfter = h.getSentMessages().length;
      expect(msgsAfter).toBe(msgsBefore);
    });

    it("kill should send SIGKILL to process and set status to stopped", async () => {
      await startAndInitialize();
      expect(h.server.status).toBe("running");

      h.client.kill();

      expect(h.mockProcess.kill).toHaveBeenCalledWith("SIGKILL");
      expect(h.server.status).toBe("stopped");
      expect((h.client as any).process).toBeNull();
      expect(h.server.pid).toBeNull();
    });

    it("kill should be a no-op if process is null", () => {
      expect((h.client as any).process).toBeNull();
      expect(() => {
        h.client.kill();
      }).not.toThrow();
      expect(h.server.status).toBe("stopped");
    });

    it("isAlive should return true when process is running", async () => {
      await startAndInitialize();
      (h.mockProcess as any).killed = false;
      expect(h.client.isAlive()).toBe(true);
    });

    it("isAlive should return false when process is null", () => {
      expect(h.client.isAlive()).toBe(false);
    });

    it("isAlive should return false when process has been killed", async () => {
      await startAndInitialize();
      (h.mockProcess as any).killed = true;
      expect(h.client.isAlive()).toBe(false);
    });
  });
});
