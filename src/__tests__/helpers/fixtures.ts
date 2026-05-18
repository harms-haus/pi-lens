import type { LspServerConfig, LspServerInstance } from "../../types.js";

export const TEST_TS_CONFIG: LspServerConfig = {
  language: "typescript",
  command: "typescript-language-server",
  args: ["--stdio"],
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  detectCommand: "typescript-language-server --version",
  installCommand: "npm install -g typescript-language-server typescript",
  installInstructions: "npm install -g typescript-language-server typescript",
};

export const TEST_PY_CONFIG: LspServerConfig = {
  language: "python",
  command: "pylsp",
  args: [],
  extensions: [".py"],
  detectCommand: "pylsp --version",
  installCommand: "pip install python-lsp-server",
  installInstructions: "pip install python-lsp-server",
};

export function createTestServerInstance(
  config: LspServerConfig = TEST_TS_CONFIG,
): LspServerInstance {
  return {
    config,
    status: "stopped",
    pid: null,
    nextId: 1,
    pendingRequests: new Map(),
    lastActive: Date.now(),
    fileVersions: new Map(),
    diagnostics: new Map(),
    rootUri: null,
  };
}
