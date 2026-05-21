# Configuration Reference

Complete guide to configuring pi-lens via `.pi-lens.json` and user-level settings.

## Global Settings

pi-lens supports one user-level setting stored in `~/.pi/agent/settings.json`. This applies across **all projects** and is separate from the per-project `.pi-lens.json` configuration.

### `piLensRenderer`

| Field           | Value                                                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `boolean`                                                                                                                                                                                            |
| **Default**     | `false`                                                                                                                                                                                              |
| **Location**    | `~/.pi/agent/settings.json`                                                                                                                                                                          |
| **Scope**       | User-level (all projects)                                                                                                                                                                            |
| **Description** | Enables a rich TUI diagnostic panel that renders after each write/edit/bash tool call that triggers diagnostic checks. When disabled, only plain-text diagnostic output is appended to tool results. |

```json
// ~/.pi/agent/settings.json
{
  "piLensRenderer": true
}
```

#### When `true`

After each tool call that triggers checks (write, edit, or bash with file-writing commands), pi-lens displays a color-coded diagnostic panel in the TUI via `registerMessageRenderer`. The panel includes:

- **Header** — file count, overall status (all clean / issues found), and check duration in milliseconds.
- **Per-check status lines** — one row each for prettier, linters, LSP, and tsc with status icons:
  - ✅ `clean` (success) — no issues detected
  - ⚠ `issues` (warning) — problems found
  - ✗ `error` (error) — check failed to run
  - ⊘ `skipped` (dim) — check disabled or not applicable
- **Expandable detail text** — full diagnostic output shown when the panel is expanded.

#### When `false` (default)

Diagnostic results are appended as plain text to tool output — the existing pi-lens behavior.

---

## Daemon Architecture

pi-lens delegates check execution to the **@harms-haus/code-lens** daemon. The `@harms-haus/code-lens` package is a production dependency of pi-lens and is installed automatically — no separate install is needed.

When checks run, pi-lens sends a `fullCheck` JSON-RPC request to the daemon over a Unix socket. The request includes the list of changed files and a subset of your configuration (check flags, timing, and timeouts) as `params.config`. The daemon owns the full check lifecycle — it starts and manages LSP servers on demand, runs prettier/linters/tsc, and returns results.

This means:

- **LSP server lifecycle** is managed entirely by the daemon, not by pi-lens itself. Settings like `lspDelayMs` are applied on the daemon side after it receives the request.
- **File pattern filtering** (`includePatterns`, `excludePatterns`) and **behavioral flags** (`bashDetection`, `alwaysReport`) are handled client-side by pi-lens before sending files to the daemon — these are not forwarded.

## File Format

pi-lens reads configuration from a `.pi-lens.json` file in your project root. The file is optional — if absent, all checks run with sensible defaults.

```json
{
  "prettier": true,
  "linters": true,
  "lsp": true,
  "tsc": true,
  "includePatterns": [],
  "excludePatterns": ["node_modules/**", ".git/**", "dist/**", "build/**"],
  "lspDelayMs": 1000,
  "maxConcurrency": 4,
  "prettierTimeoutMs": 15000,
  "linterTimeoutMs": 15000,
  "tscTimeoutMs": 30000,
  "bashDetection": true,
  "alwaysReport": true
}
```

All fields are optional. Only include the ones you want to override from defaults.

---

## Options Reference

### Check Enable/Disable

#### `prettier`

| Field           | Value                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `boolean`                                                                                                                                                            |
| **Default**     | `true`                                                                                                                                                               |
| **Description** | Enable prettier formatting checks on changed files. Runs `prettier --check` (report-only — does NOT write files). Only runs if prettier is installed in the project. |

```json
{ "prettier": false }
```

#### `linters`

| Field           | Value                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `boolean`                                                                                                                                                     |
| **Default**     | `true`                                                                                                                                                        |
| **Description** | Enable automatic linter detection and execution. pi-lens auto-detects configured linters (ESLint, Biome, Ruff, etc.) and runs them on relevant changed files. |

```json
{ "linters": false }
```

#### `lsp`

| Field           | Value                                                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `boolean`                                                                                                                                                                                 |
| **Default**     | `true`                                                                                                                                                                                    |
| **Description** | Enable LSP diagnostic queries on changed files. pi-lens starts language servers on demand and queries diagnostics after file changes. Only runs for languages with installed LSP servers. |

```json
{ "lsp": false }
```

#### `tsc`

| Field           | Value                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `boolean`                                                                                                                                                                       |
| **Default**     | `true`                                                                                                                                                                          |
| **Description** | Enable TypeScript type checking via `tsc --noEmit`. Only runs if `tsconfig.json` exists and `tsc` is available. Checks are filtered to the changed TypeScript/JavaScript files. |

```json
{ "tsc": false }
```

---

### File Patterns

#### `includePatterns`

| Field           | Value                                                                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `string[]`                                                                                                                                            |
| **Default**     | `[]` (all files included)                                                                                                                             |
| **Description** | Glob patterns for files to include in checks. When empty, all files detected from tool results are included. Patterns are matched against file paths. |

```json
{ "includePatterns": ["src/**/*.ts", "lib/**/*.js"] }
```

#### `excludePatterns`

| Field           | Value                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| **Type**        | `string[]`                                                                                                |
| **Default**     | `["node_modules/**", ".git/**", "dist/**", "build/**"]`                                                   |
| **Description** | Glob patterns for files to exclude from checks. Default excludes common generated/dependency directories. |

```json
{
  "excludePatterns": [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "vendor/**",
    "**/*.generated.ts"
  ]
}
```

---

### Timing

#### `lspDelayMs`

| Field           | Value                                                                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `number`                                                                                                                                                                                                                                                                                       |
| **Default**     | `1000` (1 second)                                                                                                                                                                                                                                                                              |
| **Description** | Milliseconds to wait after notifying LSP servers of file changes before querying diagnostics. This gives language servers time to process the changes and produce accurate diagnostics. This delay is applied by the @harms-haus/code-lens daemon, which manages its own LSP server lifecycle. |

```json
{ "lspDelayMs": 2000 }
```

#### `maxConcurrency`

| Field           | Value                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| **Type**        | `number`                                                                                                 |
| **Default**     | `4`                                                                                                      |
| **Description** | Maximum number of parallel check operations. Controls how many linters or checks can run simultaneously. |

```json
{ "maxConcurrency": 2 }
```

---

### Timeouts

#### `prettierTimeoutMs`

| Field           | Value                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `number`                                                                                                                                |
| **Default**     | `15000` (15 seconds)                                                                                                                    |
| **Description** | Maximum time in milliseconds to wait for prettier to complete. If prettier takes longer, the check is aborted and reported as an error. |

```json
{ "prettierTimeoutMs": 30000 }
```

#### `linterTimeoutMs`

| Field           | Value                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `number`                                                                                                                                                                |
| **Default**     | `15000` (15 seconds)                                                                                                                                                    |
| **Description** | Maximum time in milliseconds to wait for each linter to complete. Individual linters may have their own timeout in their definition, but this serves as an overall cap. |

```json
{ "linterTimeoutMs": 30000 }
```

#### `tscTimeoutMs`

| Field           | Value                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `number`                                                                                                                                            |
| **Default**     | `30000` (30 seconds)                                                                                                                                |
| **Description** | Maximum time in milliseconds to wait for `tsc --noEmit` to complete. TSC can be slow on large projects, so the default is higher than other checks. |

```json
{ "tscTimeoutMs": 60000 }
```

---

### Behavior

#### `bashDetection`

| Field           | Value                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `boolean`                                                                                                                                                                                                 |
| **Default**     | `true`                                                                                                                                                                                                    |
| **Description** | Enable file detection from bash commands. When enabled, pi-lens analyzes bash tool calls for file-writing patterns (`sed`, `cat`, `echo`, `tee`, `mv`, `cp`, etc.) and runs checks on the affected files. |

```json
{ "bashDetection": false }
```

#### `alwaysReport`

| Field           | Value                                                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Type**        | `boolean`                                                                                                                                                                                                 |
| **Default**     | `true`                                                                                                                                                                                                    |
| **Description** | When `true`, pi-lens always appends a result message to the tool output, even when all checks pass ("all clean"). When `false`, clean results produce no additional output, keeping tool results minimal. |

```json
{ "alwaysReport": false }
```

---

## Example Configurations

### Minimal (all defaults)

No `.pi-lens.json` file needed. Or create an empty object:

```json
{}
```

### Full configuration

```json
{
  "prettier": true,
  "linters": true,
  "lsp": true,
  "tsc": true,
  "includePatterns": [],
  "excludePatterns": ["node_modules/**", ".git/**", "dist/**", "build/**", "coverage/**"],
  "lspDelayMs": 1500,
  "maxConcurrency": 4,
  "prettierTimeoutMs": 15000,
  "linterTimeoutMs": 15000,
  "tscTimeoutMs": 30000,
  "bashDetection": true,
  "alwaysReport": true
}
```

### Prettier-only

Only run prettier checks. Disable linters, LSP, and tsc:

```json
{
  "prettier": true,
  "linters": false,
  "lsp": false,
  "tsc": false
}
```

### Linting-only

Only run linters. Disable prettier, LSP, and tsc:

```json
{
  "prettier": false,
  "linters": true,
  "lsp": false,
  "tsc": false
}
```

### LSP and TypeScript only

For projects that rely on type checking and language server diagnostics instead of traditional linters:

```json
{
  "prettier": false,
  "linters": false,
  "lsp": true,
  "tsc": true,
  "lspDelayMs": 2000,
  "tscTimeoutMs": 60000
}
```

### Fast mode

Reduce timeouts and skip slow checks for a faster feedback loop:

```json
{
  "prettier": true,
  "linters": true,
  "lsp": false,
  "tsc": false,
  "linterTimeoutMs": 5000,
  "prettierTimeoutMs": 5000,
  "alwaysReport": false
}
```

### Disable bash detection

Only check files from explicit `write` and `edit` calls:

```json
{
  "bashDetection": false
}
```
