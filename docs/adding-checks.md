# Adding New Check Types

Guide for extending pi-lens with new code quality checks.

## Overview

pi-lens runs checks in a pipeline: prettier → linters → LSP diagnostics → tsc. Each check is encapsulated in a runner module and integrated into the `hook-runner.ts` orchestrator. Adding a new check involves creating a runner module, adding types, integrating into the pipeline, adding a config option, and writing tests.

## Step-by-Step Guide

### 1. Create a Runner Module

Create a new file `src/new-check-runner.ts` following the pattern of existing runners (e.g., `prettier-runner.ts`, `tsc-runner.ts`).

Your module should export:

```typescript
/** Check if the tool is available (e.g., installed, configured) */
export async function isNewCheckAvailable(cwd: string): Promise<boolean>;

/** Run the check on the given files */
export async function runNewCheck(
  files: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<NewCheckResult[]>;

/** (Optional) Result type */
export interface NewCheckResult {
  file: string;
  // ... check-specific fields
}
```

**Key guidelines:**

- **Never throw.** Return error information in the result object instead.
- **Filter files.** Only process files with relevant extensions.
- **Use `execCommand` from `spawn-utils.ts`.** It handles timeouts, maxBuffer, and AbortSignal.
- **Be async.** All check functions should be async to avoid blocking the pipeline.
- **Return structured results.** Don't format output in the runner — that's the hook-runner's job.

**Example (based on `tsc-runner.ts`):**

```typescript
import * as path from "node:path";
import * as fs from "node:fs";
import { execCommand } from "./spawn-utils.js";

export interface NewCheckResult {
  issues: NewCheckIssue[];
  durationMs: number;
  error?: string;
}

export async function isNewCheckAvailable(cwd: string): Promise<boolean> {
  // Fast fs checks first, then version command
  if (!fs.existsSync(path.join(cwd, "config-file"))) return false;
  try {
    const result = await execCommand("tool", ["--version"], { cwd, timeout: 10_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

export async function runNewCheck(
  cwd: string,
  files?: string[],
  signal?: AbortSignal,
): Promise<NewCheckResult> {
  const startTime = Date.now();
  try {
    const result = await execCommand("tool", ["check", "--json"], {
      cwd,
      timeout: 30_000,
      signal,
    });
    const issues = parseOutput(result.stdout, cwd);
    return { issues: filterToFiles(issues, files), durationMs: Date.now() - startTime };
  } catch (err) {
    return {
      issues: [],
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

### 2. Add Types

Add your check's types to `src/types.ts`:

```typescript
/** Result of the new check */
export interface NewCheckIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
}
```

Also update `LensStatusPayload` in `types.ts` to add a new `CheckStatus` field for the check category:

```typescript
export interface LensStatusPayload {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
  newCheck: CheckStatus;  // Add this
}
```

### 3. Add Config Option

In `src/config.ts`:

1. Add the new boolean field to the `LensConfig` interface in `types.ts`:

```typescript
export interface LensConfig {
  // ... existing fields
  newCheck: boolean;  // Enable/disable new check
}
```

2. Add the default in `DEFAULT_CONFIG`:

```typescript
export const DEFAULT_CONFIG: LensConfig = {
  // ... existing defaults
  newCheck: true,
};
```

3. Add the field to the boolean merge list in `mergeConfig()`:

```typescript
for (const key of [
  "prettier", "linters", "lsp", "tsc", "bashDetection", "alwaysReport",
  "newCheck",
] as const) {
  // ...
}
```

### 4. Integrate into `hook-runner.ts`

Add a new check function following the pattern of existing checks:

```typescript
async function runNewCheckCheck(
  files: string[],
  cwd: string,
  config: LensConfig,
  signal?: AbortSignal,
): Promise<{ section: string | null; status: CheckStatus; hasIssues: boolean }> {
  if (!config.newCheck) return { section: null, status: "skipped", hasIssues: false };

  const available = await isNewCheckAvailable(cwd);
  if (!available) return { section: null, status: "skipped", hasIssues: false };

  const relevantFiles = filterToRelevantExtensions(files);
  if (relevantFiles.length === 0) return { section: null, status: "skipped", hasIssues: false };

  try {
    const result = await runNewCheck(cwd, relevantFiles, signal);
    if (result.error) {
      return { section: `  ⚠ newcheck: ${result.error}`, status: "error", hasIssues: false };
    }
    if (result.issues.length === 0) {
      return { section: "  ✅ newcheck: 0 issues", status: "clean", hasIssues: false };
    }
    // Format issues...
    return {
      section: `  ⚠ newcheck: ${result.issues.length} issue(s)\n${formattedIssues}`,
      status: "issues",
      hasIssues: true,
    };
  } catch {
    return { section: "  ⚠ newcheck: check failed", status: "error", hasIssues: false };
  }
}
```

Then add it to the `runChecks()` function's `Promise.all` array:

```typescript
const [prettier, linter, lsp, tsc, newCheck] = await Promise.all([
  runPrettierCheck(...),
  runLinterCheck(...),
  runLspCheck(...),
  runTscCheck(...),
  runNewCheckCheck(...),
]);
statuses.newCheck = newCheck.status;
if (newCheck.section) sections.push(newCheck.section);
if (newCheck.hasIssues) hasIssues = true;
```

Update the `HookCheckStatuses` interface to include your new status:

```typescript
export interface HookCheckStatuses {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
  newCheck: CheckStatus;  // Add this
}
```

### 5. Update the Status Bar

In `src/index.ts`, update `buildStatusPayload()` to include the new check:

```typescript
function buildStatusPayload(state: LensState, checkStatuses?: HookCheckStatuses): LensStatusPayload {
  return {
    // ... existing fields
    newCheck: checkStatuses?.newCheck ?? "pending",
  };
}
```

Update `LensStatusPayload` in `types.ts` accordingly.

### 6. Update the Entry Point

In `src/index.ts`, update:

1. **`session_start`** — Add availability detection:

```typescript
const [linters, prettier, tsc, newCheck] = await Promise.all([
  detectLinters(ctx.cwd),
  isPrettierAvailable(ctx.cwd),
  isTscAvailable(ctx.cwd),
  isNewCheckAvailable(ctx.cwd),
]);
state.newCheckAvailable = newCheck;
```

2. **Session notification** — Include in the startup message.

3. **`session_shutdown`** — Clean up any resources if needed.

### 7. Add Tests

Create `src/__tests__/new-check-runner.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock spawn-utils
vi.mock("../spawn-utils.js", () => ({
  execCommand: vi.fn(),
}));

// Mock fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

describe("new-check-runner", () => {
  describe("isNewCheckAvailable", () => {
    it("returns true when tool is installed and config exists", async () => {
      // ...
    });

    it("returns false when config doesn't exist", async () => {
      // ...
    });
  });

  describe("runNewCheck", () => {
    it("parses clean output correctly", async () => {
      // ...
    });

    it("parses issues from output", async () => {
      // ...
    });

    it("handles execution errors", async () => {
      // ...
    });

    it("respects AbortSignal", async () => {
      // ...
    });
  });
});
```

Also update `src/__tests__/hook-runner.test.ts` to cover the new check integration.

### 8. Update Documentation

- Add the new check to the README.md features list
- Add config option to `docs/configuration.md`
- Update the architecture docs if the module dependency graph changes
- Update `CHANGELOG.md`

## Checklist

- [ ] Runner module created (`src/new-check-runner.ts`)
- [ ] Types added to `src/types.ts`
- [ ] Config option added to `src/config.ts` and `LensConfig` interface
- [ ] Check integrated into `src/hook-runner.ts` (`runChecks` function)
- [ ] Status bar updated in `src/index.ts` and `LensStatusPayload`
- [ ] Availability detection in `session_start`
- [ ] Tests written (`src/__tests__/new-check-runner.test.ts`)
- [ ] Hook-runner tests updated
- [ ] All CI checks pass (`test`, `lint`, `typecheck`, `format:check`)
- [ ] Documentation updated
