import { describe, it, expect, vi, beforeEach } from "vitest";
import { LspClient } from "../lsp-client-methods.js";
import { createTestServerInstance } from "./helpers/fixtures.js";
import { createClientWithMock } from "./helpers/create-client-with-mock.js";

describe("LspClient JSON-RPC parsing", () => {
  let server: ReturnType<typeof createTestServerInstance>;
  let onNotification: ReturnType<typeof vi.fn>;
  let client: LspClient;

  beforeEach(() => {
    server = createTestServerInstance();
    onNotification = vi.fn();
    client = new LspClient(server, onNotification);
  });

  it("should parse a complete Content-Length message", () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: "file:///test.ts", diagnostics: [] },
    });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    (client as any).handleData(message);

    expect(onNotification).toHaveBeenCalledWith("textDocument/publishDiagnostics", {
      uri: "file:///test.ts",
      diagnostics: [],
    });
  });

  it("should handle partial messages across multiple data events", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "test", params: {} });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    const mid = Math.floor(message.length / 2);
    (client as any).handleData(message.slice(0, mid));
    expect(onNotification).not.toHaveBeenCalled();

    (client as any).handleData(message.slice(mid));
    expect(onNotification).toHaveBeenCalledWith("test", {});
  });

  it("should handle partial header", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "test", params: {} });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    (client as any).handleData("Content-Length: ");
    expect(onNotification).not.toHaveBeenCalled();

    (client as any).handleData(msg.slice("Content-Length: ".length));
    expect(onNotification).toHaveBeenCalledWith("test", {});
  });

  it("should parse multiple messages in one data chunk", () => {
    const body1 = JSON.stringify({ jsonrpc: "2.0", method: "method1", params: {} });
    const body2 = JSON.stringify({ jsonrpc: "2.0", method: "method2", params: {} });
    const msg1 = `Content-Length: ${Buffer.byteLength(body1)}\r\n\r\n${body1}`;
    const msg2 = `Content-Length: ${Buffer.byteLength(body2)}\r\n\r\n${body2}`;

    (client as any).handleData(msg1 + msg2);

    expect(onNotification).toHaveBeenCalledTimes(2);
    expect(onNotification).toHaveBeenNthCalledWith(1, "method1", {});
    expect(onNotification).toHaveBeenNthCalledWith(2, "method2", {});
  });

  it("should handle response message and resolve pending request", async () => {
    const h = createClientWithMock();
    h.autoRespond();
    await h.client.startProcess(h.config);

    const resultPromise = h.client.request("textDocument/diagnostic", {
      textDocument: { uri: "file:///test.ts" },
    });
    const msgs = h.getSentMessages();
    const req = msgs.find((m: any) => m.method === "textDocument/diagnostic");
    expect(req).toBeDefined();
    expect(req.id).toBeGreaterThan(0);

    h.sendToClient({
      jsonrpc: "2.0",
      id: req.id,
      result: { kind: "full", items: [] },
    });
    await expect(resultPromise).resolves.toEqual({ kind: "full", items: [] });
  });

  it("should handle error response and reject pending request", async () => {
    const h = createClientWithMock();
    h.autoRespond();
    await h.client.startProcess(h.config);

    const resultPromise = h.client.request("textDocument/diagnostic", {});
    const msgs = h.getSentMessages();
    const req = msgs.find((m: any) => m.method === "textDocument/diagnostic");

    h.sendToClient({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32600, message: "Invalid params" },
    });
    await expect(resultPromise).rejects.toThrow("Invalid params");
  });

  it("should send request message with correct format", async () => {
    const h = createClientWithMock();
    h.autoRespond();
    await h.client.startProcess(h.config);

    void h.client.request("textDocument/diagnostic", {
      textDocument: { uri: "file:///test.ts" },
    });

    const msgs = h.getSentMessages();
    const req = msgs.find((m: any) => m.method === "textDocument/diagnostic");
    expect(req).toMatchObject({
      jsonrpc: "2.0",
      method: "textDocument/diagnostic",
      params: { textDocument: { uri: "file:///test.ts" } },
    });
    expect(req.id).toBeTypeOf("number");
  });

  it("should send notification without id", async () => {
    const h = createClientWithMock();
    h.autoRespond();
    await h.client.startProcess(h.config);

    h.client.notify("textDocument/didOpen", { textDocument: { uri: "file:///test.ts" } });

    const msgs = h.getSentMessages();
    const notif = msgs.find((m: any) => m.method === "textDocument/didOpen");
    expect(notif).toMatchObject({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: { textDocument: { uri: "file:///test.ts" } },
    });
    expect(notif.id).toBeUndefined();
  });

  it("should timeout pending requests", async () => {
    const h = createClientWithMock();
    h.autoRespond();
    await h.client.startProcess(h.config);

    const resultPromise = h.client.request("textDocument/diagnostic", {}, 50);

    await expect(resultPromise).rejects.toThrow("timed out after 50ms");
  });

  it("should handle notification with no callback registered", () => {
    const client2 = new LspClient(server);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "randomNotification",
      params: {},
    });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    expect(() => {
      (client2 as any).handleData(message);
    }).not.toThrow();
  });

  it("should ignore messages without proper Content-Length header", () => {
    const message = "Invalid message without header\r\n\r\n";

    expect(() => {
      (client as any).handleData(message);
    }).not.toThrow();

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("should buffer partial body content", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", method: "test", params: {} });
    const message = `Content-Length: ${body.length}\r\n\r\n`;

    (client as any).handleData(message);
    expect(onNotification).not.toHaveBeenCalled();

    (client as any).handleData(body.slice(0, 10));
    expect(onNotification).not.toHaveBeenCalled();

    (client as any).handleData(body.slice(10));
    expect(onNotification).toHaveBeenCalledWith("test", {});
  });

  it("should warn on oversized messages", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = JSON.stringify({ jsonrpc: "2.0", method: "test", params: {} });
    const message = `Content-Length: ${10 * 1024 * 1024 + 1}\r\n\r\n${body}`;

    (client as any).handleData(message);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Dropping oversized message"));
    expect((client as any).buffer).toBe("");
    expect((client as any).contentLength).toBe(-1);

    warnSpy.mockRestore();
  });

  it("should reject pending requests when process exits", async () => {
    const h = createClientWithMock();
    h.autoRespond();
    await h.client.startProcess(h.config);

    const resultPromise = h.client.request("textDocument/diagnostic", {});

    h.emitExit(1, null);

    await expect(resultPromise).rejects.toThrow("LSP server exited with code 1");
  });

  it("should handle malformed JSON body", () => {
    const body = "not valid json at all";
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;

    expect(() => {
      (client as any).handleData(message);
    }).not.toThrow();

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("should update lastActive on request", async () => {
    const h = createClientWithMock();
    h.autoRespond();
    await h.client.startProcess(h.config);

    const before = h.server.lastActive;
    await new Promise((r) => setTimeout(r, 1));

    void h.client.request("textDocument/diagnostic", {});

    expect(h.server.lastActive).toBeGreaterThanOrEqual(before);
  });
});
