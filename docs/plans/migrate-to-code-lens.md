# Migration Plan: pi-lens → @harms-haus/code-lens

**Status**: Complete  
**Date**: 2026-05-18  
**Goal**: Migrate pi-lens from embedded LSP code to using `@harms-haus/code-lens` as a dependency, sharing a warm daemon over Unix socket.

---

## Overview

pi-lens currently contains its own LSP client/manager code (duplicated from code-lens-cli). This migration:

1. **Phase 1**: Adds library exports to `@harms-haus/code-lens`, adds a `fileChanged` daemon command and `raw` mode to `diagnostics`, then switches pi-lens from in-process `LspManager` to daemon client (`ensureDaemon` + `sendRequest`).
2. **Phase 2**: Migrates non-LSP modules (linter, prettier, tsc, parsers) from pi-lens into code-lens-cli as daemon commands, making pi-lens a thin daemon client.

---

## Phase 1: Library Entry Point + Daemon Client

### 1.1 — Add `fileChanged` daemon command to code-lens-cli

**File to create**: `code-lens-cli/src/commands/file-changed.ts`

```ts
import { registerCommand } from "../daemon/server.js";
import { ok, err } from "../formatting/output.js";
import { languageFromPath } from "../lsp/language-config.js";

registerCommand("fileChanged", async (params, manager, _cwd) => {
  const file = params.file as string;
  if (typeof file !== "string" || file.length === 0) {
    return err("Missing or invalid 'file' parameter.", { file });
  }

  const config = languageFromPath(file);
  if (!config) {
    // Not an error — file just doesn't have LSP support
    return ok("skipped", { skipped: true });
  }

  await manager.onFileChanged(file);
  return ok("file updated", { language: config.language });
});
```

**Behavior**:
- Params: `{ file: string }` (required)
- Calls `manager.onFileChanged(file)` which opens/updates the file in the LSP server
- Returns `{ skipped: true }` in details when no LSP server supports the file
- Returns `{ language: string }` in details on success

**File to modify**: `code-lens-cli/src/server.ts`

Add the import for the new command module (side-effect import):

```ts
import "./commands/file-changed.js";
```

Insert this line immediately after the existing command imports (after `"./commands/status.js"`) and before `import { startServer }`.

### 1.2 — Add `raw` mode to `diagnostics` command

**File to modify**: `code-lens-cli/src/commands/diagnostics.ts`

**Changes to `handleSingleFileDiagnostics`**:

Add a `raw` boolean parameter:

```ts
async function handleSingleFileDiagnostics(
  file: string,
  refresh: boolean,
  raw: boolean,    // NEW
  manager: LspManager,
  cwd: string,
) {
  const preamble = await executePreamble(file, manager, cwd);
  if ("error" in preamble) return preamble.error;

  const { filePath, config } = preamble.ok;
  const diagnostics = await manager.getDiagnostics(filePath, refresh);
  const { errors: errorCount, warnings: warningCount, info: infoCount } =
    countSeverities(diagnostics);

  // When raw=true, include structured Diagnostic[] in details
  if (raw) {
    return ok(
      `${diagnostics.length} diagnostic(s) for ${file} (${config.language})`,
      {
        file,
        language: config.language,
        errorCount,
        warningCount,
        infoCount,
        total: diagnostics.length,
        diagnostics: diagnostics.map(d => ({
          range: d.range,
          severity: d.severity,
          code: d.code,
          source: d.source,
          message: d.message,
        })),
      },
    );
  }

  // ... existing formatted text output unchanged ...
}
```

**Changes to the `registerCommand("diagnostics", ...)` handler**:

Extract `raw` from params at the top of the handler:

```ts
registerCommand("diagnostics", async (params, manager, cwd) => {
  const workspace = params.workspace === true;
  const refresh = params.refresh === true;
  const raw = params.raw === true;    // NEW
  const files = typeof params.files === "string" ? params.files : undefined;
  // ...
```

Pass `raw` to `handleSingleFileDiagnostics(params.file, refresh, raw, manager, cwd)`.

**No changes** to multi-file or workspace mode — `raw` only applies to single-file mode (the only mode pi-lens uses).

### 1.3 — Create library barrel files in code-lens-cli

#### File to create: `code-lens-cli/src/lib-client.ts`

```ts
/**
 * Library entry point: daemon client
 *
 * Re-exports everything needed to connect to a running code-lens daemon
 * and send requests over Unix socket.
 */

export { sendRequest, probeSocket } from "./daemon/client.js";
export { ensureDaemon, startDaemon, stopDaemon, isDaemonRunning, DAEMON_VERSION } from "./daemon/lifecycle.js";
export { getSocketPath, getMetadataPath } from "./utils/socket-path.js";
export type { DaemonMetadata } from "./utils/socket-path.js";
export type { DaemonRequest, DaemonResponse } from "./daemon/protocol.js";
export { DAEMON_ERROR_CODES } from "./daemon/protocol.js";
export type { CommandResult } from "./formatting/output.js";
export { ok, err } from "./formatting/output.js";
export { languageFromPath, isServerInstalled } from "./lsp/language-config.js";
export type { LspServerConfig } from "./lsp/types.js";
```

#### File to create: `code-lens-cli/src/lib-lsp.ts`

```ts
/**
 * Library entry point: LSP internals
 *
 * Re-exports LspManager and related types for direct (non-daemon) usage.
 */

export { LspManager, DEFAULT_IDLE_TIMEOUT_MS } from "./lsp/lsp-manager.js";
export type { LspServerConfig, ServerStatus, LspServerInstance, LspManagerState } from "./lsp/types.js";
export { languageFromPath, isServerInstalled } from "./lsp/language-config.js";
export { LspClient } from "./lsp/lsp-client-methods.js";
```

#### File to create: `code-lens-cli/src/lib.ts`

```ts
/**
 * Library entry point: re-exports all public API
 */

export * from "./lib-client.js";
```

> Note: The `./lsp` subpath export is available for direct LspManager use but pi-lens does NOT use it — it uses only `./client`.

### 1.4 — Update tsup.config.ts in code-lens-cli

**File to modify**: `code-lens-cli/tsup.config.ts`

Add a third entry in the array (the library bundle). The full config becomes:

```ts
import { defineConfig } from "tsup";

export default defineConfig([
  {
    // CLI entry — unchanged
    entry: ["src/cli.ts"],
    outDir: "dist",
    format: ["esm"],
    target: "es2022",
    splitting: false,
    sourcemap: true,
    banner: { js: "#!/usr/bin/env node" },
    platform: "node",
    clean: true,
    external: ["commander", "@commander-js/extra-typings", "vscode-languageserver-types"],
  },
  {
    // Server entry — unchanged
    entry: ["src/server.ts"],
    outDir: "dist",
    format: ["esm"],
    target: "es2022",
    splitting: false,
    sourcemap: true,
    platform: "node",
    clean: false,
    banner: {
      js: "try{if(process.argv[1]&&!process.argv[1].includes('://'))process.argv[1]=new URL('file://'+process.argv[1]).href}catch(e){}\n",
    },
    external: ["commander", "@commander-js/extra-typings", "vscode-languageserver-types"],
  },
  {
    // Library entry — NEW
    entry: {
      "lib": "src/lib.ts",
      "lib-client": "src/lib-client.ts",
      "lib-lsp": "src/lib-lsp.ts",
    },
    outDir: "dist",
    format: ["esm"],
    target: "es2022",
    splitting: false,
    sourcemap: true,
    platform: "node",
    clean: false,
    dts: true,
    external: ["vscode-languageserver-types"],
  },
]);
```

**Key decisions**:
- `dts: true` generates `.d.ts` files so pi-lens gets types
- `clean: false` preserves the cli.js and server.js from the first two entries
- Library bundles do NOT externalize `commander` — the daemon client code doesn't use it (only `node:net`, `node:child_process`, `node:fs`, `node:crypto`, `node:os`, `node:path`, `node:readline`). `commander` imports only exist in `cli.ts` which is not included.
- `vscode-languageserver-types` is external because pi-lens may also depend on it (avoid duplication)
- No shebang banner — these are library files, not executables
- Output files: `dist/lib.js`, `dist/lib-client.js`, `dist/lib-lsp.js` (plus `.d.ts` and `.map`)

### 1.5 — Update package.json exports in code-lens-cli

**File to modify**: `code-lens-cli/package.json`

Add `exports` and `types` fields:

```json
{
  "name": "@harms-haus/code-lens",
  "version": "0.2.0",
  "type": "module",
  "bin": {
    "code-lens": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "import": "./dist/lib.js",
      "types": "./dist/lib.d.ts"
    },
    "./client": {
      "import": "./dist/lib-client.js",
      "types": "./dist/lib-client.d.ts"
    },
    "./lsp": {
      "import": "./dist/lib-lsp.js",
      "types": "./dist/lib-lsp.d.ts"
    }
  },
  "files": ["dist/"],
  ...
}
```

**Bump version**: `0.1.0` → `0.2.0` (new feature: library exports + new commands)

### 1.6 — Build and verify code-lens-cli

After the changes above:

```bash
cd ../code-lens-cli
npm run build
```

**Verify**:
- `dist/lib.js`, `dist/lib-client.js`, `dist/lib-lsp.js` exist
- `dist/lib.d.ts`, `dist/lib-client.d.ts`, `dist/lib-lsp.d.ts` exist
- `dist/cli.js` still has the shebang
- `dist/server.js` still exists
- `npm run test` passes (existing tests should pass unchanged — no existing code was modified except `diagnostics.ts` which only adds an optional param)

### 1.7 — Add dependency in pi-lens

**File to modify**: `pi-lens/package.json`

Add to `dependencies`:
```json
"@harms-haus/code-lens": "^0.2.0"
```

Remove from `dependencies` (no longer imported directly):
```json
"vscode-languageserver-types": "^3.17.5"
```

> Note: `vscode-languageserver-types` is still needed transitively by code-lens. pi-lens's `src/output-formatter.ts` uses `countSeverities` with `{ severity?: number }[]` — no `Diagnostic` import. pi-lens's `src/hook-runner.ts` imports `Diagnostic` type — this will come through `@harms-haus/code-lens/client` which re-exports the types.

Actually, wait — pi-lens's `hook-runner.ts` imports `type { Diagnostic } from "vscode-languageserver-types"`. After Phase 1, the LSP check function will receive raw diagnostics from the daemon response (serialized JSON), not `Diagnostic` objects from the library. The `Diagnostic` type in `hook-runner.ts` is used for the local variable `allDiags`. We can either:

- Keep `vscode-languageserver-types` as a devDependency (for type-only usage)
- Or import the `Diagnostic` type from `@harms-haus/code-lens/client`

**Decision**: Keep `vscode-languageserver-types` as a **devDependency** in pi-lens for type usage. The daemon response returns plain JSON objects matching the `Diagnostic` shape — we type-assert them.

**Final dependency changes in pi-lens**:

```json
{
  "dependencies": {
    "typebox": "^1.1.38",
    "@harms-haus/code-lens": "^0.2.0"
  },
  "devDependencies": {
    ...,
    "vscode-languageserver-types": "^3.17.5"
  }
}
```

### 1.8 — Rewrite `src/index.ts` in pi-lens

**File to modify**: `pi-lens/src/index.ts`

**Remove imports**:
```ts
import { LspManager, DEFAULT_IDLE_TIMEOUT_MS } from "./lsp-manager.js";
```

**Add imports**:
```ts
import { ensureDaemon, stopDaemon, getSocketPath } from "@harms-haus/code-lens/client";
```

**Change `LensState` interface**:
```ts
interface LensState {
  detectedLinters: DetectedLinter[];
  // REMOVED: lspManager: LspManager | null;
  config: LensConfig;
  cwd: string;
  prettierAvailable: boolean;
  tscAvailable: boolean;
}
```

**Change `session_start` handler**:
```ts
pi.on("session_start", async (_event, ctx) => {
  state.cwd = ctx.cwd;
  currentCtx = ctx;
  state.config = loadConfig(ctx.cwd);

  // Start or connect to daemon (NEW — replaces new LspManager())
  await ensureDaemon(ctx.cwd);

  // Detect availability in parallel
  const [linters, prettier, tsc] = await Promise.all([
    detectLinters(ctx.cwd),
    isPrettierAvailable(ctx.cwd),
    isTscAvailable(ctx.cwd),
  ]);

  // ... rest unchanged ...
});
```

**Change `session_shutdown` handler**:
```ts
pi.on("session_shutdown", async () => {
  // Stop daemon (NEW — replaces lspManager.stopAll())
  await stopDaemon(state.cwd);
  // ... rest unchanged ...
});
```

### 1.9 — Rewrite LSP check in `src/hook-runner.ts`

**File to modify**: `pi-lens/src/hook-runner.ts`

**Remove imports**:
```ts
import type { Diagnostic } from "vscode-languageserver-types";
import type { LspManager } from "./lsp-manager.js";
import { languageFromPath } from "./language-config.js";
```

**Add imports**:
```ts
import { sendRequest, getSocketPath, languageFromPath } from "@harms-haus/code-lens/client";
import type { Diagnostic } from "vscode-languageserver-types";
```

> `Diagnostic` type stays — it's used for local variable typing of the parsed response.

**Update `LensState` interface** (re-exported from hook-runner.ts):
```ts
export interface LensState {
  detectedLinters: DetectedLinter[];
  // REMOVED: lspManager: LspManager | null;
  config: LensConfig;
  cwd: string;
  prettierAvailable: boolean;
  tscAvailable: boolean;
}
```

**Rewrite `runLspCheck` function**:

```ts
let requestIdCounter = 0;

async function runLspCheck(
  files: string[],
  cwd: string,
  config: LensConfig,
  _state: LensState,   // no longer uses lspManager
  signal?: AbortSignal,
): Promise<{ section: string | null; status: CheckStatus; hasIssues: boolean }> {
  if (!config.lsp) {
    return { section: null, status: "skipped", hasIssues: false };
  }

  const filesWithLanguage = files.filter((f) => languageFromPath(f) !== undefined);
  if (filesWithLanguage.length === 0) {
    return { section: null, status: "skipped", hasIssues: false };
  }

  try {
    const socketPath = getSocketPath(cwd);

    // Notify daemon about changed files
    for (const file of filesWithLanguage) {
      await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "fileChanged",
        params: { file },
        id: ++requestIdCounter,
      });
    }

    // Wait for diagnostics to settle
    await sleep(config.lspDelayMs, signal);

    // Collect diagnostics (raw mode)
    const allDiags: { file: string; diagnostics: Diagnostic[] }[] = [];
    for (const file of filesWithLanguage) {
      const result = await sendRequest(socketPath, {
        jsonrpc: "2.0",
        method: "diagnostics",
        params: { file, refresh: true, raw: true },
        id: ++requestIdCounter,
      });

      if (result.isError) continue;

      const rawDiags = result.details.diagnostics as Diagnostic[] | undefined;
      if (rawDiags && rawDiags.length > 0) {
        allDiags.push({ file, diagnostics: rawDiags });
      }
    }

    if (allDiags.length === 0) {
      return { section: "  ✅ lsp: 0 diagnostics", status: "clean", hasIssues: false };
    }

    const totalDiags = allDiags.reduce((sum, d) => sum + d.diagnostics.length, 0);
    const { errors, warnings } = countSeverities(allDiags.flatMap((d) => d.diagnostics));

    const diagLines = formatDiagnosticSections(allDiags, cwd);
    return {
      section: `  ⚠ lsp: ${totalDiags} diagnostic(s) (${errors} error(s), ${warnings} warning(s))\n${diagLines}`,
      status: "issues",
      hasIssues: true,
    };
  } catch {
    return { section: "  ⚠ lsp: check failed", status: "error", hasIssues: false };
  }
}
```

**Key differences from old code**:
- No `LspManager` reference — uses `sendRequest` over socket
- `requestIdCounter` is a module-level counter for unique request IDs
- Calls `fileChanged` command per file (replaces `lspManager.onFileChanged`)
- Calls `diagnostics` command with `raw: true` (replaces `lspManager.getDiagnostics`)
- Parses `result.details.diagnostics` as `Diagnostic[]`
- Error handling: if daemon request fails, treats as "check failed" (same catch-all behavior)

### 1.10 — Delete LSP files from pi-lens

**Files to delete**:
- `pi-lens/src/lsp-client.ts`
- `pi-lens/src/lsp-client-methods.ts`
- `pi-lens/src/lsp-manager.ts`
- `pi-lens/src/lsp-protocol.ts`
- `pi-lens/src/language-config.ts`
- `pi-lens/src/__tests__/lsp-client.test.ts`
- `pi-lens/src/__tests__/lsp-client-methods.test.ts`
- `pi-lens/src/__tests__/lsp-manager.test.ts`
- `pi-lens/src/__tests__/language-config.test.ts`

### 1.11 — Clean up `src/types.ts`

**File to modify**: `pi-lens/src/types.ts`

**Remove** the entire LSP types section:
- `LspServerConfig` interface
- `ServerStatus` type
- `LspServerInstance` interface
- `LspManagerState` interface

**Keep** all non-LSP types:
- `LintIssue`, `LinterDefinition`, `DetectedLinter`
- `PrettierResult`, `TscIssue`
- `LensConfig`, `CheckStatus`, `LensStatusPayload`

Also remove the `import type { Diagnostic } from "vscode-languageserver-types";` line since `Diagnostic` is no longer used in `types.ts`.

### 1.12 — Clean up `src/spawn-utils.ts`

**File to modify**: `pi-lens/src/spawn-utils.ts`

Check whether `getSanitizedEnv` is used by any remaining pi-lens modules. After Phase 1, only `execCommand` is needed by linter/prettier/tsc runners. If `getSanitizedEnv` is only used by deleted LSP files, remove it.

**Likely keep both** since `getSanitizedEnv` may be used by linter commands too — verify with grep before deleting.

### 1.13 — Update tests in pi-lens

#### `pi-lens/src/__tests__/index.test.ts`

**File to modify**: `pi-lens/src/__tests__/index.test.ts`

**Replace the `lsp-manager.js` mock**:
```ts
// REMOVE:
vi.mock("../lsp-manager.js", () => ({
  LspManager: vi.fn().mockImplementation(() => ({
    stopAll: vi.fn().mockResolvedValue(undefined),
    onFileChanged: vi.fn(),
    getDiagnostics: vi.fn(),
  })),
  DEFAULT_IDLE_TIMEOUT_MS: 300_000,
}));

// ADD:
vi.mock("@harms-haus/code-lens/client", () => ({
  ensureDaemon: vi.fn().mockResolvedValue(undefined),
  stopDaemon: vi.fn().mockResolvedValue(undefined),
  getSocketPath: vi.fn().mockReturnValue("/tmp/code-lens-test.sock"),
  sendRequest: vi.fn(),
  languageFromPath: vi.fn(),
  probeSocket: vi.fn(),
}));
```

**Update `session_start` test assertions**:
- Replace `expect(LspManager).toHaveBeenCalledWith(...)` with `expect(ensureDaemon).toHaveBeenCalledWith("/home/user/project")`

**Update `session_shutdown` test assertions**:
- Replace `expect(mockLspManager.stopAll).toHaveBeenCalled()` with `expect(stopDaemon).toHaveBeenCalledWith("/home/user/project")`

#### `pi-lens/src/__tests__/hook-runner.test.ts`

**File to modify**: `pi-lens/src/__tests__/hook-runner.test.ts`

**Replace mocks**:
```ts
// REMOVE:
vi.mock("../language-config.js", () => ({
  languageFromPath: vi.fn(),
}));

vi.mock("../lsp-manager.js", () => ({
  LspManager: vi.fn(),
  DEFAULT_IDLE_TIMEOUT_MS: 300_000,
}));

// ADD:
vi.mock("@harms-haus/code-lens/client", () => ({
  sendRequest: vi.fn(),
  getSocketPath: vi.fn().mockReturnValue("/tmp/code-lens-test.sock"),
  languageFromPath: vi.fn(),
}));
```

**Update the `LensState` type used in tests**:
```ts
// Remove lspManager from LensState objects in test data:
const state: LensState = {
  detectedLinters: [],
  config: DEFAULT_CONFIG,
  cwd: CWD,
  prettierAvailable: false,
  tscAvailable: false,
  // REMOVED: lspManager: null,
};
```

**Update LSP check tests** to verify `sendRequest` is called with correct daemon protocol messages instead of calling `lspManager` methods directly.

### 1.14 — Phase 1 Acceptance Criteria

| Criterion | How to Verify |
|---|---|
| code-lens-cli builds with library entries | `cd ../code-lens-cli && npm run build` — check `dist/lib*.js` and `dist/lib*.d.ts` exist |
| code-lens-cli tests pass | `cd ../code-lens-cli && npm run test` |
| pi-lens has no LSP imports from local files | `grep -r "from.*\./lsp" pi-lens/src/` returns nothing |
| pi-lens typecheck passes | `cd pi-lens && npm run typecheck` |
| pi-lens tests pass | `cd pi-lens && npm run test` |
| pi-lens lint passes | `cd pi-lens && npm run lint` |
| pi-lens coverage ≥ 90% | `cd pi-lens && npm run test:coverage` |
| Daemon starts on `session_start` | Unit test: `ensureDaemon` called with `ctx.cwd` |
| Daemon stops on `session_shutdown` | Unit test: `stopDaemon` called with `state.cwd` |
| LSP check sends daemon requests | Unit test: `sendRequest` called with `fileChanged` and `diagnostics` methods |
| `raw: true` diagnostics returns structured data | Integration: daemon `diagnostics` command with `raw=true` includes `details.diagnostics` array |

### 1.15 — Phase 1 Files Summary

**code-lens-cli — Files created**:
- `src/commands/file-changed.ts`
- `src/lib-client.ts`
- `src/lib-lsp.ts`
- `src/lib.ts`

**code-lens-cli — Files modified**:
- `src/commands/diagnostics.ts` — add `raw` param
- `src/server.ts` — add `file-changed.js` import
- `tsup.config.ts` — add library entry
- `package.json` — add `exports`, bump version

**pi-lens — Files modified**:
- `package.json` — add `@harms-haus/code-lens` dep, move `vscode-languageserver-types` to devDeps
- `src/index.ts` — replace LspManager with daemon client
- `src/hook-runner.ts` — replace LspManager with daemon requests
- `src/types.ts` — remove LSP type definitions
- `src/__tests__/index.test.ts` — update mocks and assertions
- `src/__tests__/hook-runner.test.ts` — update mocks and assertions

**pi-lens — Files deleted**:
- `src/lsp-client.ts`
- `src/lsp-client-methods.ts`
- `src/lsp-manager.ts`
- `src/lsp-protocol.ts`
- `src/language-config.ts`
- `src/__tests__/lsp-client.test.ts`
- `src/__tests__/lsp-client-methods.test.ts`
- `src/__tests__/lsp-manager.test.ts`
- `src/__tests__/language-config.test.ts`

**pi-lens — Files OUT OF SCOPE for Phase 1**:
- `src/config.ts` — unchanged
- `src/bash-file-detector.ts` — unchanged
- `src/prettier-runner.ts` — unchanged
- `src/tsc-runner.ts` — unchanged
- `src/linter-registry.ts` — unchanged
- `src/linter-runner.ts` — unchanged
- `src/parsers.ts` — unchanged
- `src/definitions.ts` — unchanged
- `src/spawn-utils.ts` — possibly remove unused `getSanitizedEnv`
- `src/output-formatter.ts` — unchanged
- All non-LSP test files — unchanged

---

## Phase 2: Migrate Non-LSP Modules into code-lens-cli

Phase 2 moves the linter, prettier, tsc, and related utilities from pi-lens into code-lens-cli as daemon-accessible commands. This makes the warm daemon even more valuable — it caches linter detection results and keeps prettier/tsc processes warm.

### 2.1 — Add `spawn-utils` to code-lens-cli

**File to modify**: `code-lens-cli/src/utils/spawn.ts` (or create new)

pi-lens's `src/spawn-utils.ts` has:
- `execCommand(command: string, cwd: string, timeout?: number, signal?: AbortSignal): Promise<ExecResult>`
- `ExecResult { stdout: string; stderr: string; exitCode: number | null; error?: string }`
- `getSanitizedEnv(): NodeJS.ProcessEnv`

code-lens-cli already has `getSanitizedEnv()` in `src/utils/env.ts`. Add `execCommand` and `ExecResult` to a new or existing utils file.

**Implementation**: Copy `execCommand` and `ExecResult` from `pi-lens/src/spawn-utils.ts` into `code-lens-cli/src/utils/spawn.ts`. Use `getSanitizedEnv` from the existing `src/utils/env.ts`.

### 2.2 — Copy parser and definition modules

**Files to create in code-lens-cli**:

Copy the following from pi-lens, placing them in a `src/linting/` subdirectory:

| Source (pi-lens) | Destination (code-lens-cli) | Notes |
|---|---|---|
| `src/parsers.ts` | `src/linting/parsers.ts` | 11 linter output parsers |
| `src/definitions.ts` | `src/linting/definitions.ts` | 11 linter definitions |
| `src/linter-registry.ts` | `src/linting/linter-registry.ts` | `detectLinters()`, `getLintersForFile()` |
| `src/linter-runner.ts` | `src/linting/linter-runner.ts` | `runLinter()`, `runLinters()` |
| `src/prettier-runner.ts` | `src/linting/prettier-runner.ts` | `isPrettierAvailable()`, `runPrettier()` |
| `src/tsc-runner.ts` | `src/linting/tsc-runner.ts` | `isTscAvailable()`, `runTsc()` |
| `src/bash-file-detector.ts` | `src/linting/bash-file-detector.ts` | `detectFilesFromBashCommand()` |

**Import path updates**: Change internal imports from `./spawn-utils.js` → `../utils/spawn.js`, `./types.js` → `./types.js` (new local types file), etc.

### 2.3 — Create linting types file

**File to create**: `code-lens-cli/src/linting/types.ts`

Extract from `pi-lens/src/types.ts`:
- `LintIssue`
- `LinterDefinition`
- `DetectedLinter`
- `PrettierResult`
- `TscIssue`
- `CheckStatus`

### 2.4 — Copy output formatting (lint portion)

**File to create**: `code-lens-cli/src/linting/output-formatter.ts`

Copy from `pi-lens/src/output-formatter.ts`:
- `formatIssues()`
- `summarizeIssues()`

Do NOT copy the LSP diagnostic formatting functions (`countSeverities`, `formatDiagnosticLine`, `SEVERITY_NAMES`) — code-lens-cli already has equivalents in `src/formatting/diagnostics.ts`.

### 2.5 — Add new daemon commands

**Files to create in `code-lens-cli/src/commands/`**:

#### `lint.ts`
```ts
registerCommand("lint", async (params, _manager, cwd) => {
  // params: { files: string[], maxConcurrency?: number, timeoutMs?: number }
  // 1. Detect available linters (cache in daemon process)
  // 2. Run relevant linters on files
  // 3. Return LintIssue[] in details.issues + formatted text in content
});
```

#### `prettier.ts`
```ts
registerCommand("prettier", async (params, _manager, cwd) => {
  // params: { files: string[], timeoutMs?: number }
  // 1. Check if prettier is available (cache in daemon process)
  // 2. Run prettier --check on files
  // 3. Return PrettierResult[] in details.results + formatted text in content
});
```

#### `tsc.ts`
```ts
registerCommand("tsc", async (params, _manager, cwd) => {
  // params: { files: string[], timeoutMs?: number }
  // 1. Check if tsc is available (cache in daemon process)
  // 2. Run tsc --noEmit
  // 3. Return TscIssue[] in details.issues + formatted text in content
});
```

#### `fullCheck.ts`
```ts
registerCommand("fullCheck", async (params, manager, cwd) => {
  // params: { files: string[], config: { prettier, linters, lsp, tsc, ... } }
  // Runs all checks concurrently and returns combined results
  // This is the primary command pi-lens calls in Phase 2+
});
```

**Register in `server.ts`**: Add side-effect imports:
```ts
import "./commands/lint.js";
import "./commands/prettier.js";
import "./commands/tsc.js";
import "./commands/fullCheck.js";
```

### 2.6 — Cache detection results in daemon

The `DaemonServer` class currently only holds `lspManager`. Add fields for caching non-LSP detection:

**File to modify**: `code-lens-cli/src/daemon/server.ts`

```ts
export class DaemonServer {
  // ... existing fields ...
  private detectedLinters: DetectedLinter[] | null = null;
  private prettierAvailable: boolean | null = null;
  private tscAvailable: boolean | null = null;
  // ... getters/setters or pass-through methods ...
}
```

Command handlers access these via the `manager` parameter (or extend the handler signature to include the DaemonServer). The cleanest approach: pass a context object instead of just `LspManager`:

**Option A** (minimal change): Handlers receive `manager: LspManager` and a new `context: DaemonContext` parameter. This requires changing the `CommandHandler` type.

**Option B** (simpler): Each command handler does its own caching with module-level variables (like the current pattern for `registerCommand`).

**Recommendation**: Option B for Phase 2 — module-level cache variables in each command file. This matches the existing code-lens-cli pattern and avoids changing the `CommandHandler` signature.

### 2.7 — Update pi-lens to use daemon for all checks

**File to modify**: `pi-lens/src/hook-runner.ts`

Replace direct calls to `runPrettier`, `runLinters`, `runTsc` with daemon requests:

```ts
const result = await sendRequest(socketPath, {
  jsonrpc: "2.0",
  method: "fullCheck",
  params: {
    files: filteredFiles,
    config: {
      prettier: config.prettier,
      linters: config.linters,
      lsp: config.lsp,
      tsc: config.tsc,
      lspDelayMs: config.lspDelayMs,
      maxConcurrency: config.maxConcurrency,
      prettierTimeoutMs: config.prettierTimeoutMs,
      linterTimeoutMs: config.linterTimeoutMs,
      tscTimeoutMs: config.tscTimeoutMs,
    },
  },
  id: ++requestIdCounter,
});
```

Parse the `CommandResult.details` for structured results and format the output text.

### 2.8 — Delete migrated modules from pi-lens

**Files to delete from pi-lens** (after Phase 2):
- `src/spawn-utils.ts`
- `src/parsers.ts`
- `src/definitions.ts`
- `src/linter-registry.ts`
- `src/linter-runner.ts`
- `src/prettier-runner.ts`
- `src/tsc-runner.ts`
- `src/bash-file-detector.ts`
- `src/output-formatter.ts`
- `src/__tests__/spawn-utils.test.ts`
- `src/__tests__/parsers.test.ts`
- `src/__tests__/definitions.test.ts`
- `src/__tests__/linter-registry.test.ts`
- `src/__tests__/linter-runner.test.ts`
- `src/__tests__/prettier-runner.test.ts`
- `src/__tests__/tsc-runner.test.ts`
- `src/__tests__/bash-file-detector.test.ts`

### 2.9 — pi-lens becomes a thin client

After Phase 2, `pi-lens/src/` contains only:
- `index.ts` — extension entry point (hooks, lifecycle)
- `hook-runner.ts` — file resolution + daemon orchestration
- `types.ts` — `LensConfig`, `CheckStatus`, `LensStatusPayload` (no linter/LSP types)
- `config.ts` — `.pi-lens.json` loader

pi-lens responsibility:
1. Register hooks (`session_start`, `session_shutdown`, `tool_result`)
2. Load config from `.pi-lens.json`
3. Resolve affected files from tool results
4. Send `fullCheck` request to daemon
5. Format and append results to tool output
6. Update status bar

### 2.10 — Phase 2 Acceptance Criteria

| Criterion | How to Verify |
|---|---|
| All linting modules exist in code-lens-cli | `ls ../code-lens-cli/src/linting/` shows all files |
| code-lens-cli builds and tests pass | `cd ../code-lens-cli && npm run build && npm run test` |
| pi-lens has no linter/prettier/tsc local imports | `grep -r "from.*\./\(linter\|prettier\|tsc\|parser\|definition\|spawn\|output-format\)" pi-lens/src/` returns nothing |
| pi-lens typecheck passes | `npm run typecheck` |
| pi-lens tests pass with daemon mocks | `npm run test` |
| pi-lens coverage ≥ 90% | `npm run test:coverage` |
| `fullCheck` daemon command runs all 4 checks | Integration test in code-lens-cli |
| Linter detection cached across calls | Unit test: `detectLinters` called once, cached on second call |

### 2.11 — Phase 2 Files Summary

**code-lens-cli — Files created**:
- `src/linting/types.ts`
- `src/linting/parsers.ts`
- `src/linting/definitions.ts`
- `src/linting/linter-registry.ts`
- `src/linting/linter-runner.ts`
- `src/linting/prettier-runner.ts`
- `src/linting/tsc-runner.ts`
- `src/linting/bash-file-detector.ts`
- `src/linting/output-formatter.ts`
- `src/utils/spawn.ts`
- `src/commands/lint.ts`
- `src/commands/prettier.ts`
- `src/commands/tsc.ts`
- `src/commands/fullCheck.ts`
- Tests for all new modules in `tests/linting/`

**code-lens-cli — Files modified**:
- `src/server.ts` — add command imports
- `src/daemon/server.ts` — optional: add caching fields
- `package.json` — bump version to `0.3.0`
- `tsup.config.ts` — ensure linting modules are bundled

**pi-lens — Files modified**:
- `src/index.ts` — simplify (no more local detection)
- `src/hook-runner.ts` — replace all local runners with `sendRequest("fullCheck", ...)`
- `src/types.ts` — remove all linter/prettier/tsc types
- `src/config.ts` — unchanged (still needed for `.pi-lens.json`)
- `src/__tests__/index.test.ts` — update mocks
- `src/__tests__/hook-runner.test.ts` — update mocks
- `package.json` — bump version to `2.0.0`

**pi-lens — Files deleted**:
- All files listed in §2.8

---

## Phase 3: Testing & Documentation

### 3.1 — Test migration to code-lens-cli

**Migrate tests from pi-lens to code-lens-cli**:

| Source test (pi-lens) | Destination (code-lens-cli) | Notes |
|---|---|---|
| `src/__tests__/parsers.test.ts` | `tests/linting/parsers.test.ts` | Adapt import paths |
| `src/__tests__/definitions.test.ts` | `tests/linting/definitions.test.ts` | Adapt import paths |
| `src/__tests__/linter-registry.test.ts` | `tests/linting/linter-registry.test.ts` | Adapt import paths |
| `src/__tests__/linter-runner.test.ts` | `tests/linting/linter-runner.test.ts` | Adapt import paths |
| `src/__tests__/prettier-runner.test.ts` | `tests/linting/prettier-runner.test.ts` | Adapt import paths |
| `src/__tests__/tsc-runner.test.ts` | `tests/linting/tsc-runner.test.ts` | Adapt import paths |
| `src/__tests__/bash-file-detector.test.ts` | `tests/linting/bash-file-detector.test.ts` | Adapt import paths |
| `src/__tests__/spawn-utils.test.ts` | `tests/utils/spawn.test.ts` | Adapt import paths |

**Vitest version consideration**: code-lens-cli uses vitest `^4.1.6`, pi-lens uses `^3.0.0`. The test API surface used (`describe`, `it`, `expect`, `vi`, `beforeEach`) is identical between v3 and v4. Migrated tests should work without changes beyond import paths.

### 3.2 — Update pi-lens remaining tests

- `src/__tests__/config.test.ts` — unchanged
- `src/__tests__/index.test.ts` — mock `@harms-haus/code-lens/client` for `fullCheck` results
- `src/__tests__/hook-runner.test.ts` — mock daemon responses for `fullCheck`

### 3.3 — Add integration tests for new daemon commands

In code-lens-cli, add integration tests in `tests/commands/`:

- `tests/commands/file-changed.test.ts` — verify the `fileChanged` command
- `tests/commands/lint.test.ts` — verify the `lint` command
- `tests/commands/prettier.test.ts` — verify the `prettier` command
- `tests/commands/tsc.test.ts` — verify the `tsc` command
- `tests/commands/fullCheck.test.ts` — verify the `fullCheck` command

Each test should:
1. Create a `DaemonServer` instance via `createServer()`
2. Register the command handler
3. Call `handleRequest()` with appropriate params
4. Assert response structure (`CommandResult`)

### 3.4 — Update READMEs

**code-lens-cli README**: Add section on library usage:
```markdown
## Library Usage

@harms-haus/code-lens can be used as a library:

```ts
import { ensureDaemon, sendRequest, getSocketPath } from "@harms-haus/code-lens/client";

await ensureDaemon(process.cwd());
const socketPath = getSocketPath(process.cwd());
const result = await sendRequest(socketPath, {
  jsonrpc: "2.0",
  method: "diagnostics",
  params: { file: "/path/to/file.ts", raw: true },
  id: 1,
});
```

Subpath exports:
- `@harms-haus/code-lens` — re-exports all
- `@harms-haus/code-lens/client` — daemon client functions
- `@harms-haus/code-lens/lsp` — direct LspManager access
```

**pi-lens README**: Update architecture section to document the daemon dependency.

### 3.5 — Phase 3 Acceptance Criteria

| Criterion | How to Verify |
|---|---|
| All migrated tests pass in code-lens-cli | `cd ../code-lens-cli && npm run test` |
| code-lens-cli coverage ≥ 65% (target 80%+) | `cd ../code-lens-cli && npm run test:coverage` |
| pi-lens tests pass | `npm run test` |
| pi-lens coverage ≥ 90% | `npm run test:coverage` |
| Both READMEs updated | Manual review |
| No dead code in pi-lens | `npm run lint` + `npm run typecheck` |

---

## Error Handling Strategy

### Daemon Unavailable

When `sendRequest` fails (daemon not running, socket error):

1. **`fileChanged` calls**: Silently skip. The daemon should be running — if not, it's a lifecycle bug. Log to stderr, don't block the tool result.
2. **`diagnostics` calls**: Return `{ section: "  ⚠ lsp: check failed", status: "error" }`. Same behavior as the current catch-all.
3. **`fullCheck` calls**: Return per-check error statuses. Prettier/linters/tsc/LSP each get `"error"` status.

### Daemon Version Mismatch

`ensureDaemon()` handles this automatically — if the running daemon's version doesn't match `DAEMON_VERSION`, it restarts. No additional handling needed in pi-lens.

### Request Timeout

`sendRequest` has a 60-second timeout. If a request times out:
- The promise rejects with `Error("Daemon request timed out after 60s")`
- pi-lens's `try/catch` in each check function catches this and returns `"error"` status
- The tool result still goes through — pi-lens never blocks

### Malformed Daemon Response

If `result.details.diagnostics` is not an array when expected:
- Type assertion `as Diagnostic[]` is used — this matches current behavior where LSP server output is trusted
- If the shape is wrong, downstream formatting will throw → caught by outer `try/catch` → `"error"` status

---

## Rollback Strategy

If issues arise after Phase 1 deployment:

1. Revert pi-lens to use local `LspManager` (git revert)
2. The code-lens-cli changes are backward-compatible — existing CLI users are unaffected
3. No database or persistent state changes to roll back

Phase 2 rollback:
1. Revert pi-lens to use local linter/prettier/tsc runners
2. Remove daemon commands from code-lens-cli (they're additive, no breaking changes)

---

## Implementation Order

### Recommended execution sequence:

**Phase 1 (do in one PR)**:
1. Steps 1.1–1.6 (code-lens-cli changes, build, verify)
2. Steps 1.7–1.9 (pi-lens code changes)
3. Steps 1.10–1.12 (delete files, clean up)
4. Steps 1.13 (update tests)
5. Step 1.14 (acceptance checks)

**Phase 2 (one PR, can be split into sub-PRs)**:
1. Step 2.1–2.4 (copy modules to code-lens-cli, fix imports)
2. Step 2.5–2.6 (add daemon commands, caching)
3. Copy and adapt tests (step 2.9 / 3.1)
4. Step 2.7 (update pi-lens hook-runner)
5. Step 2.8 (delete migrated files from pi-lens)
6. Steps 2.10 (acceptance checks)

**Phase 3 (one PR)**:
1. Step 3.1 (migrate tests)
2. Step 3.2 (update remaining pi-lens tests)
3. Step 3.3 (integration tests for new commands)
4. Step 3.4 (documentation)
5. Step 3.5 (acceptance checks)
