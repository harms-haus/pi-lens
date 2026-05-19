# Adding New Check Types

Guide for extending the pi-lens / code-lens check pipeline with new code quality checks.

## Architecture Overview

pi-lens is a **thin daemon client** — it does not execute checks itself. When files change, pi-lens resolves the affected file paths and sends a single `fullCheck` JSON-RPC request to the **code-lens daemon** (`@harms-haus/code-lens`). The daemon runs all checks concurrently and returns structured results.

```
pi-lens (client)                          code-lens (daemon)
─────────────────                         ──────────────────
resolveFilesFromToolResult()   ──→  fullCheck request  ──→  fullCheck.ts
filterFilesByPatterns()                                       ├─ runPrettierCheck()
                                                              ├─ runLinterCheck()
                                                              ├─ runLspCheck()
                                                              └─ runTscCheck()
                                         ←──  JSON-RPC response
hook-runner.runChecks()        ←──  statuses + sections
```

**Check logic lives in the code-lens daemon.** pi-lens only handles file resolution, config loading, and result formatting.

## Where to Make Changes

| Change | Location | Repo |
|--------|----------|------|
| Check execution logic | `src/commands/fullCheck.ts` | `code-lens-cli` |
| Standalone daemon command | `src/commands/<name>.ts` | `code-lens-cli` |
| Command registration | `src/server.ts` (side-effect import) | `code-lens-cli` |
| Check runner / availability detection | `src/linting/<name>-runner.ts` | `code-lens-cli` |
| Config option (enable/disable) | `src/types.ts` + `src/config.ts` | `pi-lens` |
| Status bar payload | `src/types.ts` (LensStatusPayload) | `pi-lens` |
| Hook check statuses | `src/hook-runner.ts` (HookCheckStatuses) | `pi-lens` |
| Unit tests | `src/__tests__/` | `code-lens-cli` |

---

## Step 1: Add the check to the code-lens daemon

### 1a. Create a runner module

Create `src/linting/<name>-runner.ts` in `code-lens-cli`. This module is responsible for availability detection and execution.

```typescript
// src/linting/newcheck-runner.ts
import { execCommand } from "../spawn-utils.js";

export interface NewCheckResult {
  issues: NewCheckIssue[];
  durationMs: number;
  error?: string;
}

export interface NewCheckIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}

/** Check if the tool is installed and configured */
export async function isNewCheckAvailable(cwd: string): Promise<boolean> {
  try {
    const result = await execCommand("newcheck", ["--version"], { cwd, timeout: 10_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Run the check and return structured results */
export async function runNewCheck(
  files: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<NewCheckResult> {
  const startTime = Date.now();
  try {
    const result = await execCommand("newcheck", ["check", "--json", ...files], {
      cwd,
      timeout: timeoutMs ?? 30_000,
      signal,
    });
    return { issues: parseOutput(result.stdout, cwd), durationMs: Date.now() - startTime };
  } catch (err) {
    return {
      issues: [],
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

**Key guidelines:**

- **Never throw.** Return errors in the result object.
- **Filter to relevant files.** Only process files your tool supports.
- **Use `execCommand`** from `spawn-utils.js` for timeouts, maxBuffer, and AbortSignal.
- **Return structured data.** Don't format human-readable text — the command handler does that.

### 1b. (Optional) Create a standalone daemon command

If the check should also be callable individually (not just via `fullCheck`), create a command file at `src/commands/<name>.ts`:

```typescript
// src/commands/newcheck.ts
import { registerCommand } from "../daemon/server.js";
import { ok, err } from "../formatting/output.js";
import { isNewCheckAvailable, runNewCheck } from "../linting/newcheck-runner.js";

registerCommand("newcheck", async (params, _manager, cwd) => {
  const files = params.files as string[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    return err("Missing or empty 'files' parameter.");
  }

  const available = await isNewCheckAvailable(cwd);
  if (!available) return ok("newcheck: not available", { available: false });

  const result = await runNewCheck(files, cwd);
  if (result.error) return ok(`newcheck: ${result.error}`, { error: result.error });

  if (result.issues.length === 0) {
    return ok(`newcheck: 0 issues (${result.durationMs}ms)`, { issues: [] });
  }

  // Format and return issues...
  return ok(`newcheck: ${result.issues.length} issue(s)`, { issues: result.issues });
});
```

### 1c. Register the command in `server.ts`

In `code-lens-cli/src/server.ts`, add a side-effect import so the command's `registerCommand()` call runs at startup:

```typescript
import "./commands/newcheck.js";   // Add this line
```

### 1d. Integrate into `fullCheck.ts`

This is the critical step. Open `src/commands/fullCheck.ts` and add your check to the concurrent pipeline:

**1. Add a cache entry** alongside the existing module-level caches:

```typescript
import { isNewCheckAvailable, runNewCheck } from "../linting/newcheck-runner.js";

// In the module-level cache section:
let cachedNewCheckAvailable: boolean | null = null;

// In ensureCache():
const [linters, prettier, tsc, newCheck] = await Promise.all([
  cachedLinters ?? detectLinters(cwd),
  cachedPrettierAvailable ?? isPrettierAvailable(cwd),
  cachedTscAvailable ?? isTscAvailable(cwd),
  cachedNewCheckAvailable ?? isNewCheckAvailable(cwd),
]);
cachedNewCheckAvailable = newCheck;
```

**2. Add a check runner function** following the pattern of `runPrettierCheck`, `runTscCheck`, etc.:

```typescript
interface NewCheckCheckResult extends CheckResult {
  issues?: NewCheckIssue[];
}

async function runNewCheckCheck(
  files: string[],
  cwd: string,
  config: FullCheckConfig,
  newCheckAvailable: boolean,
): Promise<NewCheckCheckResult> {
  if (!config.newCheck) return { section: null, status: "skipped", hasIssues: false };
  if (!newCheckAvailable) return { section: null, status: "skipped", hasIssues: false };

  const relevantFiles = filterToRelevantExtensions(files);
  if (relevantFiles.length === 0) return { section: null, status: "skipped", hasIssues: false };

  try {
    const result = await runNewCheck(relevantFiles, cwd, undefined, config.newCheckTimeoutMs);
    if (result.error) {
      return { section: `  ⚠ newcheck: ${result.error}`, status: "error", hasIssues: false };
    }
    if (result.issues.length > 0) {
      const formatted = formatNewCheckIssues(result.issues, cwd);
      return {
        section: `  ⚠ newcheck: ${result.issues.length} issue(s)\n${formatted}`,
        status: "issues",
        hasIssues: true,
        issues: result.issues,
      };
    }
    return { section: "  ✅ newcheck: 0 issues", status: "clean", hasIssues: false };
  } catch {
    return { section: "  ⚠ newcheck: check failed", status: "error", hasIssues: false };
  }
}
```

**3. Add to the `Promise.all` array** in the `fullCheck` handler and collect results:

```typescript
const [prettierResult, linterResult, lspResult, tscResult, newCheckResult] = await Promise.all([
  runPrettierCheck(safeFiles, cwd, config, cachedPrettierAvailable!),
  runLinterCheck(safeFiles, cwd, config, cachedLinters!),
  runLspCheck(safeFiles, cwd, config, manager),
  runTscCheck(safeFiles, cwd, config, cachedTscAvailable!),
  runNewCheckCheck(safeFiles, cwd, config, cachedNewCheckAvailable!),  // Add
]);

// Collect results:
statuses.newcheck = newCheckResult.status;
if (newCheckResult.section) sections.push(newCheckResult.section);
if (newCheckResult.hasIssues) hasIssues = true;
```

**4. Extend `FullCheckConfig`** to accept the new check's config flag and any timeout:

```typescript
interface FullCheckConfig {
  // ... existing fields
  newCheck?: boolean;
  newCheckTimeoutMs?: number;
}
```

---

## Step 2: Add config options in pi-lens

This step is only needed if the new check should be toggleable via `.pi-lens.json`.

### 2a. Update `LensConfig` in `src/types.ts`

```typescript
export interface LensConfig {
  // ... existing fields
  /** Enable/disable new check */
  newCheck: boolean;
  /** Timeout for new check (ms) */
  newCheckTimeoutMs: number;
}
```

### 2b. Update `src/config.ts`

Add defaults:

```typescript
export const DEFAULT_CONFIG: LensConfig = {
  // ... existing defaults
  newCheck: true,
  newCheckTimeoutMs: 30_000,
};
```

Add to the merge lists in `mergeConfig()`:

```typescript
// Boolean fields
for (const key of [
  "prettier", "linters", "lsp", "tsc", "bashDetection", "alwaysReport",
  "newCheck",  // Add
] as const) { /* ... */ }

// Number fields
for (const key of [
  "lspDelayMs", "maxConcurrency", "prettierTimeoutMs", "linterTimeoutMs", "tscTimeoutMs",
  "newCheckTimeoutMs",  // Add
] as const) { /* ... */ }
```

### 2c. Update `HookCheckStatuses` in `src/hook-runner.ts`

```typescript
export interface HookCheckStatuses {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
  newCheck: CheckStatus;  // Add
}
```

In the `runChecks()` function, initialize the new status and pass the config flag to the daemon:

```typescript
const statuses: HookCheckStatuses = {
  // ... existing
  newCheck: "skipped",
};

// In the sendRequest params.config:
config: {
  // ... existing
  newCheck: config.newCheck,
  newCheckTimeoutMs: config.newCheckTimeoutMs,
},
```

Extract the status from the daemon response:

```typescript
if (daemonStatuses) {
  // ... existing
  statuses.newCheck = daemonStatuses.newCheck;
}
```

### 2d. Update `LensStatusPayload` in `src/types.ts`

```typescript
export interface LensStatusPayload {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
  newCheck: CheckStatus;  // Add
}
```

Then update `buildStatusPayload()` in `src/index.ts` to include `newCheck: checkStatuses?.newCheck ?? "pending"`.

---

## Step 3: Write tests

All check logic tests belong in `code-lens-cli`:

### 3a. Runner tests (`code-lens-cli`)

Create `src/__tests__/newcheck-runner.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("../spawn-utils.js", () => ({
  execCommand: vi.fn(),
}));

describe("newcheck-runner", () => {
  describe("isNewCheckAvailable", () => {
    it("returns true when tool is installed", async () => { /* ... */ });
    it("returns false when tool is missing", async () => { /* ... */ });
  });

  describe("runNewCheck", () => {
    it("parses clean output", async () => { /* ... */ });
    it("parses issues from JSON output", async () => { /* ... */ });
    it("handles execution errors gracefully", async () => { /* ... */ });
    it("respects AbortSignal", async () => { /* ... */ });
  });
});
```

### 3b. fullCheck integration tests (`code-lens-cli`)

Update or create tests for the `fullCheck` command that cover the new check being enabled, disabled, unavailable, and producing issues.

### 3c. pi-lens config tests (`pi-lens`)

Update existing config tests to verify the new fields merge correctly from `.pi-lens.json`.

---

## Checklist

- [ ] Runner module created (`code-lens-cli/src/linting/<name>-runner.ts`)
- [ ] (Optional) Standalone command created (`code-lens-cli/src/commands/<name>.ts`)
- [ ] Command registered in `code-lens-cli/src/server.ts`
- [ ] Check integrated into `code-lens-cli/src/commands/fullCheck.ts`
- [ ] `FullCheckConfig` extended with new config flag + timeout
- [ ] Availability detection cached in `ensureCache()`
- [ ] `LensConfig` updated in `pi-lens/src/types.ts`
- [ ] Defaults and merge updated in `pi-lens/src/config.ts`
- [ ] `HookCheckStatuses` updated in `pi-lens/src/hook-runner.ts`
- [ ] Config forwarded to daemon in `runChecks()`
- [ ] `LensStatusPayload` updated in `pi-lens/src/types.ts`
- [ ] Status bar updated in `pi-lens/src/index.ts`
- [ ] Runner tests written in `code-lens-cli`
- [ ] fullCheck integration tests updated in `code-lens-cli`
- [ ] Config tests updated in `pi-lens`
- [ ] Documentation updated (README, configuration docs)
- [ ] All CI checks pass (`test`, `lint`, `typecheck`, `format:check`)
