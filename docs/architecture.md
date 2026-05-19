# Architecture

Deep-dive technical reference for the **pi-lens** extension and its companion **@harms-haus/code-lens** daemon.

## 1. System Overview

pi-lens is a thin client extension for the pi coding agent. It detects files changed by the agent and delegates all code quality checking to a long-running **@harms-haus/code-lens** daemon process. The two components communicate over a Unix domain socket (or named pipe on Windows) using JSON-RPC.

```
┌──────────────────────┐         Unix socket          ┌─────────────────────────────┐
│  pi-lens (extension) │  ──── fullCheck request ───►  │  @harms-haus/code-lens      │
│                      │                                │  (daemon)                   │
│  • Hook registration │  ◄── JSON-RPC response ─────  │                             │
│  • File resolution   │                                │  • Prettier                 │
│  • Config loading    │                                │  • Linters (eslint, etc.)   │
│  • Bash detection    │                                │  • LSP diagnostics          │
│  • Status bar UI     │                                │  • tsc --noEmit             │
└──────────────────────┘                                └─────────────────────────────┘
```

**pi-lens** is responsible only for:
- Registering hooks (`session_start`, `session_shutdown`, `tool_result`)
- Resolving which files were affected by a tool call
- Starting/stopping the daemon
- Formatting results for the agent

**@harms-haus/code-lens** (the daemon) is responsible for:
- Executing all checks (prettier, linters, LSP diagnostics, tsc)
- Caching linter detection, tool availability, and LSP server instances across requests
- Managing LSP server lifecycle (lazy start, idle timeout, diagnostics cache)

pi-lens exposes a single integration point:

| Integration | Event | Description |
|---|---|---|
| Event Hook | `tool_result` | Resolves affected files and sends them to the daemon for a full check |

The extension is loaded by pi directly from TypeScript. The entry point is `src/index.ts` (default export function), referenced by the `pi.extensions` array in `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

---

## 2. Module Descriptions

pi-lens consists of five modules:

### `index.ts` — Extension Entry Point

Registers three hooks and manages the daemon lifecycle:

- **`session_start`** — Loads config via `loadConfig()`, calls `ensureDaemon()` to start or connect to the daemon, publishes initial status.
- **`session_shutdown`** — Calls `stopDaemon()` to shut down the daemon, clears status bar, resets state.
- **`tool_result`** — Filters to `write`/`edit`/`bash` tool calls only. Resolves affected files, sends them to the daemon via `runChecks()`, and appends formatted results to the tool result content.

Imports from: `@harms-haus/code-lens/client` (daemon lifecycle), `config.ts`, `hook-runner.ts`, `types.ts`.

### `hook-runner.ts` — Daemon Client & File Resolution

The core orchestration module. Responsible for:

1. **File resolution** — `resolveFilesFromToolResult()` extracts file paths from tool results:
   - `write`/`edit` → reads `input.path`
   - `bash` → delegates to `detectFilesFromBashCommand()`
   - Filters to paths contained within `cwd` (path traversal prevention)
   - Deduplicates and verifies files exist on disk

2. **File filtering** — `filterFilesByPatterns()` applies `includePatterns`/`excludePatterns` from config using compiled glob regexes (cached for the session).

3. **Daemon communication** — `runChecks()` sends a `fullCheck` JSON-RPC request to the daemon over the Unix socket. Parses the response to extract per-check statuses and formatted issue text.

4. **Result formatting** — Builds the final text to append to the tool result, including a header with file count and duration.

Exports: `resolveFilesFromToolResult()`, `runChecks()`, `filterFilesByPatterns()`, `LensState`, `HookResult`, `HookCheckStatuses`.

### `types.ts` — Core Types

Pure type declarations with no runtime code:

- **`LensConfig`** — Configuration shape (check toggles, patterns, timeouts, etc.)
- **`CheckStatus`** — Union type: `"pending" | "running" | "clean" | "issues" | "error" | "skipped"`
- **`LensStatusPayload`** — Status bar payload with a `CheckStatus` per check category

### `config.ts` — Configuration Loader

Reads `.pi-lens.json` from the project root and merges with defaults:

- Returns `DEFAULT_CONFIG` if the file is missing, unreadable, or contains malformed JSON
- Type-safe merging: only known keys with correct types are applied; unknown keys and wrong-typed values are silently ignored
- Warnings are printed to stderr for parse errors

### `bash-file-detector.ts` — Bash Command Analysis

Regex-based analysis of bash command strings to detect file-writing patterns. Runs client-side because it operates on the raw tool result before any daemon communication.

Supports: `sed -i`, `cat >`, `echo >`, `tee`, `perl -i`, `awk >`, `python -c >`, `dd of=`, `mv`, `cp`, and generic shell redirects (`>`/`>>`).

---

## 3. Data Flow

### Hook Flow (tool_result)

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
         │     ├─ Filter to paths within cwd (path traversal prevention)
         │     └─ Deduplicate + verify files exist on disk
         │
         ├─ filterFilesByPatterns()
         │     └─ Apply include/exclude glob patterns (cached regex)
         │
         └─ runChecks(filteredFiles, cwd, config)
               │
               ├─ getSocketPath(cwd) → Unix socket path
               │
               ├─ sendRequest(socketPath, {
               │     jsonrpc: "2.0",
               │     method: "fullCheck",
               │     params: { files, config }
               │   })
               │     │
               │     ▼  ┌──────────────────────────────────────┐
               │        │ Daemon runs checks concurrently:      │
               │        │  1. prettier --check                  │
               │        │  2. linters (eslint, etc.)            │
               │        │  3. LSP diagnostics (with delay)      │
               │        │  4. tsc --noEmit                      │
               │        └──────────────────────────────────────┘
               │     │
               │     ▼
               │   Response: { content, details: { statuses, hasIssues } }
               │
               ├─ Extract statuses from daemon response
               ├─ Build result text (header + issue sections)
               └─ Return HookResult { text, statuses, durationMs }

  index.ts appends result.text to tool result content
```

### State Flow

```
session_start
  ├─ state.cwd = ctx.cwd
  ├─ currentCtx = ctx
  ├─ loadConfig(cwd)              → state.config
  ├─ ensureDaemon(cwd)            → starts daemon if not running
  ├─ ctx.ui.notify('pi-lens: ready', 'info')
  └─ publishStatus()              → ui.setStatus("pi-lens", payload)

tool_result
  ├─ resolveFilesFromToolResult()
  ├─ runChecks(files, cwd, config)
  │     └─ Returns HookResult { text, statuses, durationMs }
  ├─ publishStatus(statuses)      → ui.setStatus("pi-lens", payload)
  └─ Return modified tool result with appended content

session_shutdown
  ├─ stopDaemon(cwd)              → SIGTERM daemon, clean socket/metadata
  ├─ ui.setStatus("pi-lens", undefined)
  └─ Reset state to defaults
```

---

## 4. State Management

### LensState

Client-side state is minimal — just config and the working directory:

```typescript
interface LensState {
  config: LensConfig;
  cwd: string;
}
```

All check execution state (linter detection, tool availability, LSP server instances) lives in the daemon and is cached there across requests. The client holds no references to check runners, LSP managers, or detection results.

### Closure State in index.ts

Beyond `LensState`, `index.ts` maintains two module-level variables:

```typescript
let currentCtx: ExtensionContext | undefined;   // Current session context
let lastStatus: string | undefined;             // Last published status JSON (for dedup)
```

Status deduplication is performed by comparing JSON strings — if the status payload hasn't changed, `ui.setStatus` is not called again.

### Glob Regex Caching

`filterFilesByPatterns` compiles glob patterns into `RegExp` objects. Compiled regexes are cached in a module-level `globRegexCache` Map keyed by the joined patterns string. Since patterns come from config and don't change during a session, this cache grows to at most two entries and is reused for the entire session.

### Daemon-Side Caching

The daemon caches the following across `fullCheck` requests (invalidated on cwd change):

| Cache | Type | Populated By |
|---|---|---|
| `cachedLinters` | `DetectedLinter[]` | `detectLinters(cwd)` |
| `cachedPrettierAvailable` | `boolean` | `isPrettierAvailable(cwd)` |
| `cachedTscAvailable` | `boolean` | `isTscAvailable(cwd)` |
| LSP server instances | `LspManager` | Maintained across requests with idle-timeout eviction |

This means the first `fullCheck` request pays the detection cost, but subsequent requests reuse cached results. The daemon remains warm as long as the session is active.

---

## 5. Daemon Lifecycle

### Socket Path Resolution

Each project directory gets a unique socket path derived from a SHA-256 hash of the cwd:

- **Unix:** `$TMPDIR/code-lens-{hash}.sock`
- **Windows:** `\\.\pipe\code-lens-{hash}`

The same hash is used for the metadata file at `~/.code-lens/{hash}.json`, which stores the daemon PID, socket path, version, and cwd.

### `ensureDaemon(cwd)`

Called during `session_start`. Ensures a daemon is running for the project:

1. Probes the socket to check if a daemon is already listening.
2. If running, reads metadata and compares `version` against `DAEMON_VERSION`. Restarts on version mismatch.
3. If not running, cleans stale socket/metadata files and spawns a new daemon process.
4. Polls the socket every 50ms (up to 10s) until the daemon is ready.
5. Writes metadata (PID, socket path, version, cwd) to disk.

The daemon is spawned as a detached child process (`child.unref()`), so it outlives the parent. It receives the socket path and cwd via environment variables (`CODE_LENS_SOCKET_PATH`, `CODE_LENS_CWD`).

### `stopDaemon(cwd)`

Called during `session_shutdown`:

1. Reads metadata to get the daemon PID.
2. Sends `SIGTERM` to the daemon process.
3. Waits 100ms for the OS to clean up the socket file.
4. Removes socket and metadata files.

### Daemon Communication Protocol

Requests are sent as single-line JSON (NDJSON) over the Unix socket:

```json
{
  "jsonrpc": "2.0",
  "method": "fullCheck",
  "params": {
    "files": ["/path/to/file.ts"],
    "config": {
      "prettier": true,
      "linters": true,
      "lsp": true,
      "tsc": true,
      "lspDelayMs": 1000,
      "maxConcurrency": 4,
      "prettierTimeoutMs": 30000,
      "linterTimeoutMs": 30000,
      "tscTimeoutMs": 60000
    }
  },
  "id": 1
}
```

The daemon responds with a `CommandResult`:

```json
{
  "id": 1,
  "result": {
    "isError": false,
    "content": [{ "type": "text", "text": "..." }],
    "details": {
      "statuses": { "prettier": "issues", "linters": "clean", "lsp": "skipped", "tsc": "clean" },
      "hasIssues": true,
      "fileCount": 2,
      "durationMs": 342
    }
  }
}
```

Requests timeout after 60 seconds. Socket connection errors (daemon not running, socket stale) cause the hook to silently return the original tool result unmodified.

---

## 6. Error Handling

pi-lens follows a **never-block** principle:

1. **Hook failures are silently swallowed.** If `runChecks()` throws (daemon unavailable, socket error, timeout), the `catch` block in `index.ts` returns `undefined`, and the original tool result passes through unmodified.
2. **Daemon unavailable → graceful skip.** If the daemon cannot be reached, `sendRequest` rejects. The error is caught in `runChecks`, which returns an empty `HookResult` with all statuses set to `"skipped"`.
3. **Malformed config falls back to defaults.** A broken `.pi-lens.json` produces a warning on stderr but doesn't crash.
4. **Individual check failures are contained by the daemon.** If prettier fails, linters/LSP/tsc still run — each check runner has its own try/catch and returns an independent status.
5. **Daemon request errors return `isError: true`.** The daemon wraps internal failures into a structured error response rather than crashing. pi-lens checks `result.isError` and returns an empty result if set.

This ensures pi-lens is purely advisory — it can never break the agent's primary workflow.

---

## 7. Bash File Detection

`bash-file-detector.ts` analyzes bash command strings to detect file-writing patterns. This runs client-side because it operates on the raw tool result before any daemon communication.

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

Commands are split on `&&`, `;`, `|`, and newlines. Each segment is processed independently:

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

When unsure, files are conservatively included in the `written` set to avoid missing real changes.

### Toggle

Bash file detection is controlled by the `bashDetection` config flag (default: `true`). When disabled, bash tool results produce no files for checking.
