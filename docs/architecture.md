# Architecture

Deep-dive technical reference for the **pi-lens** extension.

## 1. Overview

pi-lens is a pi coding agent extension that provides unified code quality checking by automatically running prettier, linters, LSP diagnostics, and `tsc` on files changed by the agent. It combines the linter infrastructure from [pi-lint](https://github.com/harms-haus/pi-lint) and the LSP client from [pi-lsp](https://github.com/harms-haus/pi-lsp) into a single hook-only extension.

pi-lens exposes a single integration point:

| Integration | Event | Description |
|---|---|---|
| Event Hook | `tool_result` | Runs all checks on files affected by `write`, `edit`, or `bash` tool calls |

The extension is loaded by pi directly from TypeScript. The entry point is `src/index.ts` (default export function), referenced by the `pi.extensions` array in `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

All state is held in a `LensState` object within module-level closures, scoped per session.

---

## 2. Module Dependency Graph

```
index.ts
├── hook-runner.ts
│   ├── bash-file-detector.ts
│   ├── prettier-runner.ts
│   │   └── spawn-utils.ts
│   ├── tsc-runner.ts
│   │   └── spawn-utils.ts
│   ├── linter-runner.ts
│   │   ├── linter-registry.ts
│   │   │   ├── definitions.ts
│   │   │   │   └── parsers.ts
│   │   │   └── types.ts
│   │   ├── output-formatter.ts
│   │   └── spawn-utils.ts
│   ├── output-formatter.ts
│   ├── linter-registry.ts      (getLintersForFile)
│   ├── lsp-manager.ts          (onFileChanged, getDiagnostics)
│   │   ├── lsp-client-methods.ts
│   │   │   └── lsp-client.ts
│   │   │       └── lsp-protocol.ts
│   │   └── language-config.ts
│   └── types.ts
├── linter-registry.ts          (detectLinters)
├── lsp-manager.ts              (LspManager constructor)
├── prettier-runner.ts          (isPrettierAvailable)
├── tsc-runner.ts               (isTscAvailable)
├── config.ts                   (loadConfig)
└── types.ts                     (shared by all)
```

**Module boundaries:**

- **`types.ts`** — Pure type declarations. No runtime code. Shared across all modules.
- **`config.ts`** — Loads and validates `.pi-lens.json`. Depends only on `types.ts`.
- **`spawn-utils.ts`** — Child process spawning with timeout, maxBuffer, and AbortSignal support. Exports `getSanitizedEnv()` which builds an allowlisted environment for all child processes. Standalone utility.
- **`definitions.ts`** — Static `LINTER_DEFINITIONS[]` array. Imports parsers but is otherwise self-contained.
- **`parsers.ts`** — Pure functions `(stdout, cwd) => LintIssue[]`. No imports other than `node:path` and types.
- **`linter-registry.ts`** — Detection and file discovery. Depends on `definitions.ts` (for definitions) and `types.ts`.
- **`linter-runner.ts`** — Process spawning and output formatting. Depends on `linter-registry.ts`, `output-formatter.ts`, and `spawn-utils.ts`.
- **`output-formatter.ts`** — Issue formatting and summarization. Depends only on `types.ts`.
- **`bash-file-detector.ts`** — Regex-based bash command analysis. Standalone (depends only on `node:path`, `node:os`).
- **`prettier-runner.ts`** — Prettier availability detection and `--check` execution. Depends on `spawn-utils.ts` and `types.ts`.
- **`tsc-runner.ts`** — TypeScript compiler detection and execution. Depends on `spawn-utils.ts` and `types.ts`.
- **`lsp-protocol.ts`** — JSON-RPC and LSP type definitions. No runtime code.
- **`lsp-client.ts`** — LSP client transport (JSON-RPC over stdio). Depends on `lsp-protocol.ts`.
- **`lsp-client-methods.ts`** — LSP protocol methods (initialize, didOpen, didChange, diagnostics). Depends on `lsp-client.ts`.
- **`lsp-manager.ts`** — Server lifecycle, file tracking, diagnostics cache. Depends on `lsp-client-methods.ts` and `language-config.ts`.
- **`language-config.ts`** — 33 language server configurations. Depends on `types.ts`.
- **`hook-runner.ts`** — Main orchestrator. Imports from all runners and formatters.
- **`index.ts`** — Extension entry point. Imports from all modules except parsers and definitions directly (accessed transitively).

---

## 3. Data Flow

### Hook Flow

```
Agent calls write/edit/bash tool
         │
         ▼
   Tool executes, produces result
         │
         ▼
  pi fires tool_result event
         │
         ▼
  index.ts: tool_result handler
         │
         ├─ Filter: only write/edit/bash, non-error results
         │
         ├─ resolveFilesFromToolResult()
         │     ├─ write/edit → input.path
         │     ├─ bash → detectFilesFromBashCommand()
         │     └─ Filter to paths within cwd (path traversal prevention)
         │
         ├─ filterFilesByPatterns()
         │     └─ Apply include/exclude glob patterns (cached regex)
         │
         └─ runChecks(filteredFiles, cwd, config, state, signal)
               │
               ├─ 1. runPrettierCheck()
               │     └─ isPrettierAvailable() + runPrettier()
               │
               ├─ 2. runLinterCheck()
               │     └─ getRelevantLinters() + runLinters()
               │
               ├─ 3. runLspCheck()
               │     └─ lspManager.onFileChanged()
               │        + sleep(lspDelayMs)
               │        + lspManager.getDiagnostics()
               │
               ├─ 4. runTscCheck()
               │     └─ isTscAvailable() + runTsc()
               │
               └─ Format results → append to tool_result content
```

### State Flow

```
session_start
  ├─ loadConfig(cwd)              → state.config
  ├─ new LspManager(cwd)          → state.lspManager
  ├─ detectLinters(cwd)           → state.detectedLinters
  ├─ isPrettierAvailable(cwd)     → state.prettierAvailable
  ├─ isTscAvailable(cwd)          → state.tscAvailable
  └─ publishStatus()              → ui.setStatus("pi-lens", payload)

tool_result
  ├─ resolveFilesFromToolResult()
  ├─ runChecks(files, ...)
  │     └─ Returns HookResult { text, statuses, durationMs }
  ├─ publishStatus(statuses)      → ui.setStatus("pi-lens", payload)
  └─ Return modified tool result with appended content

session_shutdown
  ├─ lspManager.stopAll()
  ├─ ui.setStatus("pi-lens", undefined)
  └─ Clear all state
```

---

## 4. State Management

### LensState

All session state is held in a single `LensState` object:

```typescript
interface LensState {
  detectedLinters: DetectedLinter[];   // Linters detected at session start
  lspManager: LspManager | null;       // LSP server manager
  config: LensConfig;                  // Merged configuration
  cwd: string;                         // Current working directory
  prettierAvailable: boolean;          // Whether prettier is installed
  tscAvailable: boolean;               // Whether tsc + tsconfig.json exist
}
```

The state object is initialized in the default export function of `index.ts` and passed through to `runChecks()` in `hook-runner.ts`. All mutations happen during `session_start` and `session_shutdown`.

#### Cached Availability Booleans

`prettierAvailable` and `tscAvailable` are probed once during `session_start` (in parallel alongside linter detection) and cached in `LensState`. The individual check runners (`runPrettierCheck`, `runTscCheck`) receive these cached values as parameters. If the value is already `false`, the check is immediately skipped without re-probing. If the value is `undefined` (not cached), the runner falls back to probing availability on demand. In practice, `index.ts` always populates both fields at session start, so the on-demand path is a safety net.

#### Glob Regex Caching

`filterFilesByPatterns` compiles glob patterns into `RegExp` objects. To avoid re-compiling the same patterns on every `tool_result` hook, compiled regexes are cached in a module-level `globRegexCache` Map (keyed by the joined patterns string). Since include/exclude patterns come from config and don't change during a session, this cache grows to at most two entries (one for includes, one for excludes) and is reused for the entire session lifetime.

### Sanitized Environment

All child processes spawned by pi-lens (prettier, linters, tsc, LSP servers) receive a sanitized environment via `getSanitizedEnv()` from `spawn-utils.ts`. Instead of inheriting the full `process.env`, only an allowlisted set of variables is passed:

- **Essential:** `PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `NODE_PATH`
- **Language-specific:** `GOPATH`, `PYTHONPATH`, `CARGO_HOME`, `RUSTUP_HOME`

This prevents leaking sensitive or unnecessary environment variables (e.g., API keys, tokens) to child processes.

### Path Containment Validation

`resolveFilesFromToolResult` filters resolved absolute paths to only those that fall within the project's `cwd`. After resolving to absolute paths and normalizing, each path is checked with `startsWith(normalizedCwd)` or strict equality with `cwd`. This prevents path traversal — a bash command like `echo > /etc/something` or a relative path escaping the project root is silently dropped from the file set.

### Additional Closure State

Beyond `LensState`, `index.ts` maintains:

```typescript
let currentCtx: ExtensionContext | undefined;   // Current session context
let lastStatus: string | undefined;             // Last published status JSON (for dedup)
```

### Status Payload

The status bar receives a JSON-stringified `LensStatusPayload`:

```typescript
interface LensStatusPayload {
  prettier: CheckStatus;         // "pending" | "running" | "clean" | "issues" | "error" | "skipped"
  linters: CheckStatus;          // Aggregate linter status
  lsp: CheckStatus;              // Aggregate LSP status
  tsc: CheckStatus;              // Same as prettier
}
```

Status is published (1) on session start, (2) after every `tool_result` hook, and (3) cleared on shutdown. Deduplication is performed by comparing JSON strings.

---

## 5. LSP Server Lifecycle

LSP servers are managed by `LspManager` with a lazy-start, idle-timeout pattern:

### Lazy Start

1. When `onFileChanged(file)` is called, `LspManager` looks up the language config for the file.
2. If no server is running for that language, one is started:
   - Spawns the LSP server process via `LspClient`
   - Sends the `initialize` request with `rootUri`
   - Sends `initialized` notification
3. The file is opened via `textDocument/didOpen` (or updated via `textDocument/didChange` if already tracked).
4. Diagnostics are requested via pull model (`textDocument/diagnostic`).

### Idle Timeout

- Each server tracks `lastActive` timestamp.
- An interval timer (`IDLE_CHECK_INTERVAL_MS`, 60s) checks for idle servers.
- Servers idle longer than `DEFAULT_IDLE_TIMEOUT_MS` (5 min) are shut down gracefully.
- Graceful shutdown: `shutdown` request → `exit` notification → force kill after delay.

### Diagnostics Cache

- Push-model diagnostics arrive via `textDocument/publishDiagnostics` notifications and are cached per URI.
- Pull-model diagnostics are requested explicitly via `textDocument/diagnostic`.
- `getDiagnostics(file, refresh)` returns cached diagnostics (optionally refreshing first).
- Cache is invalidated when files change.

### File Tracking

- `ensureFileOpen(client, config, filePath, content)` opens files and tracks versions.
- Version numbers increment on each `didChange` notification.
- Maximum tracked files: 200 per server (oldest entries evicted).

---

## 6. Check Execution Order

Checks run **concurrently** via `Promise.all` for maximum throughput. Since prettier is report-only (it never writes changes), all four checks are independent and can safely execute in parallel:

1. **Prettier** — Report-only. Detects files needing formatting. No files are modified.
2. **Linters** — Run detected linters on changed files. Independent of prettier since prettier doesn't write.
3. **LSP Diagnostics** — Queries language servers after a configurable delay (`lspDelayMs`, default 1s). This delay allows servers to process changes.
4. **TSC** — Runs `tsc --noEmit` for full project type-checking.

Each check is gated by:
- Its config flag (`config.prettier`, `config.linters`, `config.lsp`, `config.tsc`)
- Runtime availability (is the tool installed? are there relevant files?)

When a check is not applicable (disabled, not installed, no matching files), its status is set to `"skipped"` and no section is added to the output.

---

## 7. Bash File Detection

`bash-file-detector.ts` analyzes bash command strings to detect file-writing patterns:

### Supported Patterns

| Pattern | Detection | Files Reported |
|---------|-----------|----------------|
| `sed -i 's/old/new/g' file` | `sed` with `-i` flag | Written: `file` |
| `sed 's/old/new/g' in > out` | `sed` with redirect | Written: `out` |
| `cat > file << EOF` | `cat` with redirect | Written: `file` |
| `echo "text" > file` | `echo`/`printf` with redirect | Written: `file` |
| `tee file` | `tee` command | Written: `file` |
| `perl -i -pe '...' file` | `perl` with `-i` flag | Written: `file` |
| `awk '{print}' in > out` | `awk` with redirect | Written: `out` |
| `python -c "..." > file` | `python` with redirect | Written: `file` |
| `dd of=file` | `dd` with `of=` | Written: `file` |
| `mv src dst` | `mv` command | Written: `dst`, Read: `src` |
| `cp src dst` | `cp` command | Written: `dst`, Read: `src` |
| `> file` / `>> file` | Generic redirect (fallback) | Written: `file` |

### Multi-Command Handling

Commands are split on `&&`, `;`, `|`, and newlines. Each segment is processed independently. For example:

```
echo "a" > a.txt && echo "b" > b.txt
```

Produces: `written: [a.txt, b.txt]`

### Limitations

This is best-effort detection. It cannot handle:
- Arbitrary shell functions or aliases
- Complex variable expansion (`echo > $OUTFILE`)
- Commands inside subshells or eval strings
- Indirect file operations (`xargs -I{} mv {} {}.bak`)

When unsure, files are conservatively included in the `written` set.

---

## 8. Error Handling Philosophy

pi-lens follows a **never-block** principle:

1. **Hook failures are silently swallowed.** The original tool result is always returned unmodified.
2. **Individual check failures don't abort the pipeline.** If prettier fails, linters/LSP/tsc still run.
3. **Missing tools are silently skipped.** No prettier, no linters, no tsc? No problem — the applicable checks report `"skipped"`.
4. **Malformed config falls back to defaults.** A broken `.pi-lens.json` produces a warning on stderr but doesn't crash.
5. **LSP server errors are contained.** A crashed server is detected and restarted on next use.

This ensures that pi-lens is purely advisory — it can never break the agent's primary workflow.
