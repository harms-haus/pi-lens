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

- Registering hooks (`session_start`, `session_shutdown`, `tool_result`, `tool_execution_update`, `tool_execution_end`)
- Resolving which files were affected by a tool call
- Monitoring subagent activity during `delegate_to_subagents` and checking git-changed files
- Starting/stopping the daemon
- Formatting results for the agent
- Rendering diagnostic results in the TUI via a custom message renderer (`registerMessageRenderer`)

**@harms-haus/code-lens** (the daemon) is responsible for:

- Executing all checks (prettier, linters, LSP diagnostics, tsc)
- Caching linter detection, tool availability, and LSP server instances across requests
- Managing LSP server lifecycle (lazy start, idle timeout, diagnostics cache)

pi-lens exposes three integration points:

| Integration      | Event                   | Description                                                                                                                         |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Event Hook       | `tool_result`           | Resolves affected files from write/edit/bash calls and sends them to the daemon for a full check                                    |
| Event Hook       | `tool_execution_update` | Monitors `delegate_to_subagents` for tool activity and triggers checks on git-changed files with a 5-second cooldown                |
| Event Hook       | `tool_execution_end`    | Forces a final check when `delegate_to_subagents` completes, bypassing cooldown                                                     |
| Message Renderer | `pi-lens-diagnostics`   | Custom renderer registered via `pi.registerMessageRenderer()` that displays check results with colour-coded status icons in the TUI |

The `tool_result` hook operates on individual tool calls (synchronous, blocking). The subagent hooks (`tool_execution_update` / `tool_execution_end`) operate on the streaming progress of the `delegate_to_subagents` tool — they are fire-and-forget and never block the agent.

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

pi-lens consists of seven modules:

### `index.ts` — Extension Entry Point

Registers five hooks and manages the daemon lifecycle:

- **`session_start`** — Loads config via `loadConfig()`, reads the renderer toggle via `loadRendererSetting()` into the `rendererEnabled` flag, calls `ensureDaemon()` to start or connect to the daemon, publishes initial status, resets the subagent checker.
- **`session_shutdown`** — Calls `stopDaemon()` to shut down the daemon, clears status bar, resets state (including `rendererEnabled = false`), clears the subagent checker.
- **`tool_result`** — Filters to `write`/`edit`/`bash` tool calls only. Resolves affected files, sends them to the daemon via `runChecks()`, publishes status, sends a structured diagnostic message via `sendDiagnosticMessage()` if `rendererEnabled` is true, and appends formatted results to the tool result content.
- **`tool_execution_update`** — Monitors `delegate_to_subagents` for tool activity in partial results. When activity is detected, triggers a code-lens check on git-changed files with a 5-second cooldown. Also sends diagnostic messages if `rendererEnabled` is true.
- **`tool_execution_end`** — Forces a final check when `delegate_to_subagents` completes, bypassing cooldown.

At factory level (before any session), registers the message renderer:

- **`pi.registerMessageRenderer("pi-lens-diagnostics", renderLensDiagnostics)`** — Registers the custom TUI renderer from `renderer.ts`. This happens once when the extension function is called, not per-session.

Contains five module-scope helpers:

- **`buildStatusPayload(checkStatuses?)`** — Builds the `LensStatusPayload` object for the status bar. Maps per-check statuses to a unified payload with `pending` defaults for missing values.
- **`hasToolActivity(partialResult)`** — Inspects `partialResult.details.windows[].lines[].kind` looking for `"tool"` entries. Returns `true` if any tool activity is detected in the streaming partial result. Uses defensive null checks throughout.
- **`resolveChangedFilesFromGit(pi, cwd)`** — Runs `git diff --name-only HEAD` via `pi.exec` to discover files changed since the last commit. Deduplicates results and filters to files that exist on disk.
- **`createSubagentChecker(pi, state, publishStatus)`** — Factory function that encapsulates all subagent monitoring state (cooldown timing, in-flight tracking, pending flags, shutdown signal). Returns a `SubagentChecker` interface.
- **`sendDiagnosticMessage(pi, ctx, result, fileCount)`** — Sends a structured diagnostic message via `pi.sendMessage()` with `customType: "pi-lens-diagnostics"` and a `LensDiagnosticDetails` payload. Called from both the `tool_result` handler and the subagent checker's `runChecksAndPublish()`. Wrapped in try/catch so it never fails the original tool result.

### SubagentChecker Interface

The `SubagentChecker` object manages cooldown-gated check scheduling:

| Method / Getter           | Description                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `runChecksAndPublish()`   | Async: resolves git-changed files, runs checks via the daemon, publishes status. Fire-and-forget. |
| `scheduleCooldownCheck()` | Schedules a check after the remaining cooldown time. Cancels any existing timer.                  |
| `markPending()`           | Sets the `hasPendingCheck` flag — used to coalesce multiple rapid updates into one check.         |
| `clear()`                 | Cancels timers, sets the shutdown flag, resets all state. Used during `session_shutdown`.         |
| `reset()`                 | Calls `clear()` then unsets the shutdown flag. Used during `session_start`.                       |
| `lastCheckTime`           | Getter — timestamp of the last completed check.                                                   |
| `checkInFlight`           | Getter — whether a check is currently running.                                                    |
| `hasPendingCheck`         | Getter — whether a check has been deferred by cooldown logic.                                     |

Imports from: `@harms-haus/code-lens/client` (daemon lifecycle), `config.ts`, `helpers.ts`, `hook-runner.ts`, `renderer.ts`, `types.ts`.

### `renderer.ts` — TUI Diagnostic Renderer

Provides the custom message renderer registered via `pi.registerMessageRenderer("pi-lens-diagnostics", renderLensDiagnostics)`. Displays diagnostic check results with colour-coded status icons in the pi TUI.

Exports:

- **`LensDiagnosticDetails`** (interface) — Structured diagnostic payload: per-check statuses (`prettier`, `linters`, `lsp`, `tsc`), `hasIssues` flag, `fileCount`, `durationMs`, and optional `sectionsText`.
- **`renderLensDiagnostics(message, options, theme)`** — The renderer function. Accepts a message object with optional `details` (a `LensDiagnosticDetails`) and `content`, plus an `{ expanded }` options flag and a `Theme` object providing `fg()`/`bg()` colour methods. Returns an object with a `render(width)` method (the `DiagnosticPanel` contract).

Internal components:

- **`DiagnosticPanel`** — Minimal inline class satisfying the `{ render(width: number): string[] }` TUI contract. Defined inline to avoid importing `@earendil-works/pi-tui` at build time (that package is only available at runtime through pi-coding-agent).
- **`stripAnsi(text)`** — Security helper that removes ANSI escape sequences from text before rendering. Applied to `sectionsText` when the panel is expanded.
- **`renderStatusIcon(status, theme)`** — Maps a check status to a themed icon string.
- **`renderStatusLabel(status, theme)`** — Maps a check status to a themed label string.

Handles six status types, each with a dedicated theme colour and icon:

| Status    | Icon | Theme Key | Label   |
| --------- | ---- | --------- | ------- |
| `clean`   | ✅   | `success` | clean   |
| `issues`  | ⚠    | `warning` | issues  |
| `error`   | ✗    | `error`   | error   |
| `skipped` | ⊘    | `dim`     | skipped |
| `running` | ●    | `muted`   | running |
| `pending` | ●    | `muted`   | pending |

**Never throws** — the entire `renderLensDiagnostics` body is wrapped in a try/catch that returns a safe fallback panel on any error.

Imports from: (none — self-contained).

### `hook-runner.ts` — Daemon Client & File Resolution

The core orchestration module. Responsible for:

1. **File resolution** — `resolveFilesFromToolResult()` extracts file paths from tool results:
   - `write`/`edit` → reads `input.path`
   - `bash` → delegates to `detectFilesFromBashCommand()`
   - Filters to paths contained within `cwd` (path traversal prevention)
   - Deduplicates and verifies files exist on disk

2. **File filtering** — `filterFilesByPatterns()` applies `includePatterns`/`excludePatterns` from config using compiled glob regexes (cached for the session).

3. **Daemon communication** — `runChecks()` sends a `fullCheck` JSON-RPC request to the daemon over the Unix socket. Response parsing is delegated to `parseDaemonResponse()`, which validates the response structure using `isRecord()` type guards and extracts per-check statuses, issue flags, and formatted text.

4. **Result formatting** — Builds the final text to append to the tool result, including a header with file count and duration.

Imports from: `@harms-haus/code-lens/client` (daemon lifecycle), `bash-file-detector.ts`, `helpers.ts`, `types.ts`.

Exports: `resolveFilesFromToolResult()`, `runChecks()`, `filterFilesByPatterns()`, `formatCleanMessage()`, `LensState`, `HookResult`, `HookCheckStatuses`.

### `helpers.ts` — Shared Type Guards

Runtime type guard utilities used across modules.

- **`isRecord(value)`** — Type guard that checks if a value is a non-null, non-array object (`typeof === "object" && value !== null && !Array.isArray(value)`). Used by `index.ts` and `hook-runner.ts` to safely traverse untyped API payloads without `as` casts.

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

Also exports **`loadRendererSetting()`** — reads the `piLensRenderer` boolean from `~/.pi/agent/settings.json`. Returns `true` only if the field exists and is a boolean `true`; returns `false` on any error (file not found, malformed JSON, missing field, wrong type). Non-`ENOENT` errors are warned to stderr; `ENOENT` is silently ignored. This setting controls whether pi-lens sends structured diagnostic messages to the TUI via `pi.sendMessage()`.

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
         └─ runChecks(files, cwd, config)
               │
               ├─ filterFilesByPatterns()
               │     └─ Apply include/exclude glob patterns (cached regex)
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

  index.ts:
    ├─ publishStatus(statuses) → ui.setStatus("pi-lens", payload)
    ├─ rendererEnabled?
    │     └─ sendDiagnosticMessage(pi, ctx, result, fileCount)
    │           └─ pi.sendMessage({ customType: "pi-lens-diagnostics", ... })
    │                 └─ TUI renders via registered renderLensDiagnostics()
    └─ Append result.text to tool result content (plain text, for LLM consumption)
```

### Subagent Check Flow (tool_execution_update / tool_execution_end)

```
Agent runs delegate_to_subagents tool
         │
         ▼
  pi fires tool_execution_update events (streaming)
         │
         ▼
  index.ts: tool_execution_update handler
         │
         ├─ Filter: only delegate_to_subagents
         ├─ hasToolActivity(partialResult)
         │     └─ Inspect partialResult.details.windows[].lines[].kind === 'tool'
         │
         ├─ Cooldown logic:
         │     ├─ Cooldown elapsed AND no check in-flight?
         │     │     └─ checker.runChecksAndPublish()  (immediate)
         │     └─ Cooldown NOT elapsed OR check in-flight?
         │           ├─ checker.markPending()
         │           └─ If no check in-flight: checker.scheduleCooldownCheck()
         │
         └─ runChecksAndPublish() internals:
               ├─ resolveChangedFilesFromGit(pi, cwd)
               │     └─ git diff --name-only HEAD → deduplicated, existing files
               ├─ runChecks(files, cwd, config)
               │     └─ Daemon fullCheck request (same as tool_result flow)
               ├─ publishStatus(result.statuses)
               ├─ rendererEnabled AND result.text?
               │     └─ sendDiagnosticMessage(pi, ctx, result, files.length)
               │           └─ pi.sendMessage({ customType: "pi-lens-diagnostics", ... })
               │                 └─ TUI renders via registered renderLensDiagnostics()
               └─ If hasPendingCheck: scheduleCooldownCheck()

  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

  pi fires tool_execution_end event (when delegate_to_subagents completes)
         │
         ▼
  index.ts: tool_execution_end handler
         │
         ├─ Filter: only delegate_to_subagents
         └─ checker.runChecksAndPublish()  (forced, bypasses cooldown)
```

**Cooldown algorithm (5-second minimum between checks):**

Multiple rapid `tool_execution_update` events are coalesced via the `hasPendingCheck` flag. When a check completes and finds `hasPendingCheck === true`, it schedules another check after the remaining cooldown time. This ensures at most one daemon request per 5-second window while still catching the latest state.

### State Flow

```
session_start
  ├─ state.cwd = ctx.cwd
  ├─ currentCtx = ctx
  ├─ loadConfig(cwd)              → state.config
  ├─ loadRendererSetting()        → rendererEnabled
  ├─ ensureDaemon(cwd)            → starts daemon if not running
  ├─ ctx.ui.notify('pi-lens: ready', 'info')
  ├─ publishStatus()              → ui.setStatus("pi-lens", payload)
  └─ checker.reset()              → clear timers, reset shutdown flag

tool_result
  ├─ resolveFilesFromToolResult()
  ├─ runChecks(files, cwd, config)
  │     └─ Returns HookResult { text, statuses, durationMs }
  ├─ publishStatus(statuses)      → ui.setStatus("pi-lens", payload)
  ├─ rendererEnabled AND result.text?
  │     └─ sendDiagnosticMessage() → pi.sendMessage() → TUI renderLensDiagnostics()
  └─ Return modified tool result with appended content (plain text for LLM)

tool_execution_update (subagent streaming)
  ├─ hasToolActivity(partialResult)?
  ├─ Cooldown elapsed, no check in-flight? → checker.runChecksAndPublish()
  └─ Otherwise → checker.markPending() + scheduleCooldownCheck()

tool_execution_end (subagent complete)
  └─ checker.runChecksAndPublish()  (forced, no cooldown)

session_shutdown
  ├─ stopDaemon(cwd)              → SIGTERM daemon, clean socket/metadata
  ├─ checker.clear()              → cancel timers, set shutdown flag
  ├─ ui.setStatus("pi-lens", undefined)
  ├─ rendererEnabled = false
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

Beyond `LensState`, `index.ts` maintains three module-level variables:

```typescript
let currentCtx: ExtensionContext | undefined; // Current session context
let lastStatus: string | undefined; // Last published status JSON (for dedup)
let rendererEnabled: boolean = false; // Whether TUI diagnostic messages are enabled
```

**`rendererEnabled`** is set from `loadRendererSetting()` during `session_start` (reads the `piLensRenderer` boolean from `~/.pi/agent/settings.json`). It is reset to `false` during `session_shutdown`. When `true`, both the `tool_result` handler and the subagent checker's `runChecksAndPublish()` call `sendDiagnosticMessage()` after each check to send a structured `LensDiagnosticDetails` payload to the TUI. When `false`, diagnostic messages are not sent and only the plain-text appendage to the tool result is produced (for LLM consumption).

Status deduplication is performed by comparing JSON strings — if the status payload hasn't changed, `ui.setStatus` is not called again.

### Glob Regex Caching

`filterFilesByPatterns` compiles glob patterns into `RegExp` objects. Compiled regexes are cached in a module-level `globRegexCache` Map keyed by the joined patterns string. Since patterns come from config and don't change during a session, this cache grows to at most two entries and is reused for the entire session.

### Subagent Checker State

The `createSubagentChecker` factory encapsulates all subagent monitoring state in closure variables — no class or external object is involved:

```typescript
// Encapsulated within createSubagentChecker closure:
let lastCheckTime: number = 0; // Timestamp of last completed check
let checkInFlight: boolean = false; // Whether a daemon request is active
let pendingTimer: setTimeout | undefined; // Cooldown timer handle
let hasPendingCheck: boolean = false; // Coalescing flag for rapid updates
let shutdown: boolean = false; // Prevents post-shutdown execution
```

The **`shutdown` flag** is critical for correctness across async boundaries. When `clear()` is called during `session_shutdown`, it sets `shutdown = true`. Any in-flight `runChecksAndPublish()` call checks this flag after each `await` point and exits early if set. This prevents stale daemon requests from publishing status to a destroyed session context.

The factory is **reset** (not recreated) on each `session_start` via `checker.reset()`, which calls `clear()` and then unsets the shutdown flag.

### Daemon-Side Caching

The daemon caches the following across `fullCheck` requests (invalidated on cwd change):

| Cache                     | Type               | Populated By                                          |
| ------------------------- | ------------------ | ----------------------------------------------------- |
| `cachedLinters`           | `DetectedLinter[]` | `detectLinters(cwd)`                                  |
| `cachedPrettierAvailable` | `boolean`          | `isPrettierAvailable(cwd)`                            |
| `cachedTscAvailable`      | `boolean`          | `isTscAvailable(cwd)`                                 |
| LSP server instances      | `LspManager`       | Maintained across requests with idle-timeout eviction |

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
      "prettierTimeoutMs": 15000,
      "linterTimeoutMs": 15000,
      "tscTimeoutMs": 30000
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

| Pattern                      | Detection                     | Files Reported              |
| ---------------------------- | ----------------------------- | --------------------------- |
| `sed -i 's/old/new/g' file`  | `sed` with `-i` flag          | Written: `file`             |
| `sed 's/old/new/g' in > out` | `sed` with redirect           | Written: `out`              |
| `cat > file << EOF`          | `cat` with redirect           | Written: `file`             |
| `echo "text" > file`         | `echo`/`printf` with redirect | Written: `file`             |
| `tee file`                   | `tee` command                 | Written: `file`             |
| `perl -i -pe '...' file`     | `perl` with `-i` flag         | Written: `file`             |
| `awk '{print}' in > out`     | `awk` with redirect           | Written: `out`              |
| `python -c "..." > file`     | `python` with redirect        | Written: `file`             |
| `dd of=file`                 | `dd` with `of=`               | Written: `file`             |
| `mv src dst`                 | `mv` command                  | Written: `dst`, Read: `src` |
| `cp src dst`                 | `cp` command                  | Written: `dst`, Read: `src` |
| `> file` / `>> file`         | Generic redirect (fallback)   | Written: `file`             |

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
