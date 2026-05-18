/**
 * LSP Protocol Types - JSON-RPC message types and minimal LSP parameter/result interfaces
 *
 * 
 */

// ── JSON-RPC Message Types ─────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ── LSP Protocol Types (minimal subset for diagnostics) ────────────────────

export interface InitializeParams {
  processId: number | null;
  clientInfo?: { name: string; version?: string };
  rootUri: string | null;
  initializationOptions?: Record<string, unknown>;
  capabilities: {
    textDocument?: {
      synchronization?: { didSave?: boolean };
      completion?: { completionItem?: { snippetSupport?: boolean } };
      diagnostic?: { dynamicRegistration?: boolean };
    };
    workspace?: {
      workspaceFolders?: boolean;
      symbol?: { dynamicRegistration?: boolean };
    };
    window?: {
      workDoneProgress?: boolean;
    };
  };
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface DidChangeTextDocumentParams {
  textDocument: { uri: string; version: number };
  contentChanges: { text: string }[];
}
