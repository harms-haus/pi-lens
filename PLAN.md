# pi-lens Implementation Plan

A unified pi extension that hooks after `write`/`edit`/`bash` tools and automatically runs prettier, linters, LSP diagnostics, and `tsc` on changed files — reporting status back to the agent.

## Source References

Adapted from:
- **pi-lint** (`../pi-lint/`) — linter detection, execution, output formatting, auto-lint hook
- **pi-lsp** (`../pi-lsp/`) — LSP client, server lifecycle, diagnostics cache

---

## Phase 1: Project Scaffolding

### 1.1 Create `package.json`

**File:** `package.json`

Create with:
```json
{
  "name": "pi-lens",
  "version": "1.0.0",
  "description": "Unified code quality extension for pi — auto-runs prettier, linters, LSP diagnostics, and tsc on changed files",
  "type": "module",
  "main": "src/index.ts",
  "files": [
    "src/**/*.ts",
    "!src/__tests__/**",
    "docs/",
    "skills/",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  "publishConfig": {
    "access": "public"
  },
  "keywords": [
    "pi-package",
    "pi-extension",
    "linter",
    "prettier",
    "lsp",
    "tsc",
    "code-quality"
  ],
  "author": "harms-haus",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/harms-haus/pi-lens.git"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "lint": "eslint src/",
    "lint:fix": "eslint --fix src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "format": "prettier --write src/",
    "format:check": "prettier --check src/",
    "typecheck": "tsc --noEmit"
  },
  "pi": {
    "extensions": [
      "./src/index.ts"
    ]
  },
  "dependencies": {
    "typebox": "^1.1.38",
    "vscode-languageserver-types": "^3.17.5"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "^0.74.0",
    "@eslint/js": "^9.0.0",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^3.2.4",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^10.1.8",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
```

Key differences from pi-lint:
- Added `vscode-languageserver-types` as a runtime dependency (from pi-lsp)
- Name is `pi-lens`
- Combined keywords

**Verify:** `cat package.json` shows valid JSON with all fields.

---

### 1.2 Create `tsconfig.json`

**File:** `tsconfig.json`

Copy from pi-lint's tsconfig.json:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

**Verify:** `npx tsc --noEmit` (after src/ exists) passes.

---

### 1.3 Create `vitest.config.ts`

**File:** `vitest.config.ts`

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/**/*.test.ts",
        "src/**/setup.ts",
        "src/**/helpers/**",
        "src/**/*.d.ts",
        "src/types.ts",
        "src/types/**",
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
```

**Verify:** `npx vitest run` (after tests exist) runs without config errors.

---

### 1.4 Create `eslint.config.js`

**File:** `eslint.config.js`

Copy from pi-lint's eslint.config.js (stricter rules):
- `eslint.configs.recommended` + `tseslint.configs.strictTypeChecked` + `prettierConfig`
- Strict rules for `src/**/*.ts`: no-explicit-any error, max-depth 5, max-lines-per-function 100, complexity 15
- Relaxed rules for test/setup/helper files
- Ignores: `dist/`, `node_modules/`, `coverage/`, `vitest.config.ts`

**Verify:** `npx eslint src/` (after src/ exists) runs without config errors.

---

### 1.5 Create `.prettierrc`

**File:** `.prettierrc`

```json
{
  "tabWidth": 2,
  "useTabs": false,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true
}
```

**Verify:** `npx prettier --check src/` (after src/ exists) works.

---

### 1.6 Create `.editorconfig`

**File:** `.editorconfig`

```ini
root = true

[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
```

**Verify:** File exists and is valid.

---

### 1.7 Create `.gitignore`

**File:** `.gitignore`

```
node_modules/
dist/
.DS_Store
coverage/
.ruff_cache/
.mypy_cache/
.bifrost.yaml
```

**Verify:** `git status` ignores appropriate directories.

---

### 1.8 Create `LICENSE`

**File:** `LICENSE`

MIT License, copyright 2025 harms-haus (identical to pi-lint/pi-lsp).

**Verify:** File contains full MIT license text.

---

### 1.9 Create `README.md` (placeholder)

**File:** `README.md`

```markdown
# pi-lens

> Unified code quality extension for [pi](https://github.com/earendil-works/pi-coding-agent)

pi-lens hooks after `write`, `edit`, and `bash` tool calls and automatically runs:
- **Prettier** — format changed files in place
- **Linters** — run detected linters (ESLint, Biome, Ruff, etc.)
- **LSP Diagnostics** — check for language server diagnostics
- **TypeScript** — run `tsc --noEmit` on changed TS/JS files

All results are reported inline back to the agent.

**Status:** In development
```

**Verify:** File exists.

---

### 1.10 Create `.github/workflows/ci.yml`

**File:** `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20, 22]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - run: npm ci

      - name: Type check
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Format check
        run: npm run format:check

      - name: Test
        run: npm test
```

**Verify:** File is valid YAML.

---

### 1.11 Create `.github/workflows/publish.yml`

**File:** `.github/workflows/publish.yml`

```yaml
name: Publish

on:
  push:
    tags:
      - "v*"

jobs:
  publish-dry-run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Publish dry run
        run: npm publish --dry-run
```

**Verify:** File is valid YAML.

---

### 1.12 Run `npm install`

**Command:** `npm install`

Installs all dependencies. Verifies package.json is valid.

**Verify:** `node_modules/` exists, `npm ls --depth=0` shows all deps.

---

## Phase 2: Foundation Modules (from pi-lint)

### 2.1 Create `src/types.ts`

**File:** `src/types.ts`

Copy from `../pi-lint/src/types.ts` and extend with new types:

**Keep from pi-lint:**
- `LintIssue` — normalized lint issue (file, line, column, severity, message, code, source)
- `LinterDefinition` — static linter blueprint (name, label, languages, extensions, configFiles, lintCommand, parseOutput, timeout)
- `DetectedLinter` — runtime detected linter (definition, configFile, version, detectionSource)
- `LintFilesParams` — tool parameters

**Add new types:**
- `PrettierResult` — `{ file: string; changed: boolean; error?: string }` — result of running prettier on a file
- `TscIssue` — `{ file: string; line: number; column: number; severity: "error" | "warning"; message: string; code?: string }` — parsed tsc diagnostic
- `LensCheckType` — `"prettier" | "linter" | "lsp" | "tsc"` — discriminant for check result types
- `LensCheckResult` — `{ type: LensCheckType; issues: (LintIssue | TscIssue)[]; durationMs: number; error?: string }` — single check run result
- `LensConfig` — configuration interface (see Phase 4 for full definition)
- `CheckStatus` — `"pending" | "running" | "clean" | "issues" | "error" | "skipped"` — status of a check
- `LensStatusPayload` — `{ prettier: CheckStatus; linters: CheckStatus; lsp: CheckStatus; tsc: CheckStatus }` — unified status bar payload

**Verify:** `npx tsc --noEmit` passes after file is created.

---

### 2.2 Create `src/spawn-utils.ts`

**File:** `src/spawn-utils.ts`

Copy verbatim from `../pi-lint/src/spawn-utils.ts`:
- `ExecResult` interface (stdout, stderr, exitCode)
- `execCommand()` function — spawn wrapper with maxBuffer, timeout, AbortSignal support

No modifications needed — this is a pure utility.

**Verify:** TypeScript compiles. Tests will verify behavior.

---

### 2.3 Create `src/definitions.ts`

**File:** `src/definitions.ts`

Copy verbatim from `../pi-lint/src/definitions.ts`:
- All 11 `LINTER_DEFINITIONS` entries: eslint, biome, ruff, flake8, pylint, mypy, clippy, staticcheck, rubocop, shellcheck, stylelint
- Each with: name, label, languages, extensions, configFiles, packageKeys, projectMarkers, versionCommand, lintCommand, parseOutput, timeout

Import parsers from `./parsers.js` (same as pi-lint pattern).

**Verify:** `npx tsc --noEmit` passes.

---

### 2.4 Create `src/parsers.ts`

**File:** `src/parsers.ts`

Copy verbatim from `../pi-lint/src/parsers.ts`:
- All inline interfaces (EslintFileResult, BiomeDiagnostic, RuffResult, PylintResult, MypyResult, ClippyMessage, StaticcheckResult, RubocopOffense, ShellcheckResult, StylelintWarning, etc.)
- All 11 parser functions: `parseEslintOutput`, `parseBiomeOutput`, `parseRuffOutput`, `parseFlake8Output`, `parsePylintOutput`, `parseMypyOutput`, `parseClippyOutput`, `parseStaticcheckOutput`, `parseRubocopOutput`, `parseShellcheckOutput`, `parseStylelintOutput`
- All helper functions: `biomeResolvePath`, `biomeSeverity`, `biomeDiagnosticToIssue`, `clippyMessageToIssues`, `rubocopSeverity`, `rubocopOffenseToIssue`

**Verify:** `npx tsc --noEmit` passes.

---

### 2.5 Create `src/linter-registry.ts`

**File:** `src/linter-registry.ts`

Copy from `../pi-lint/src/linter-registry.ts`:
- `IGNORE_DIRS` set
- `PYPROJECT_SECTIONS` map
- `CFG_SECTIONS` map
- `detectLinters(cwd)` — config file scanning, package.json checks, project markers, parallel version verification
- `getLintersForFile(filePath, detected)` — filter by extension
- `getCoveredExtensions(detected)` — all covered extensions
- `discoverFilesNative(cwd, extensions, maxFiles, signal)` — recursive file discovery
- Helper functions: `findConfigFile`, `checkPackageJson`, `checkProjectMarkers`, `verifyInstalled`, `checkLinterCandidate`

**Verify:** `npx tsc --noEmit` passes.

---

### 2.6 Create `src/linter-runner.ts`

**File:** `src/linter-runner.ts`

Copy from `../pi-lint/src/linter-runner.ts`:
- `runLinter(linter, files, cwd, signal)` — run single linter on files
- `runLinters(linters, files, cwd, signal)` — run multiple linters, dispatch to parallel
- `runLintersInParallel()` — internal helper with pre-grouped files by extension
- `runProjectLint(linters, cwd, signal)` — discover files + run all linters
- Re-exports: `formatIssues`, `summarizeIssues` from output-formatter

**Verify:** `npx tsc --noEmit` passes.

---

### 2.7 Create `src/output-formatter.ts`

**File:** `src/output-formatter.ts`

Copy from `../pi-lint/src/output-formatter.ts`:
- `formatIssues(issues, cwd?)` — format LintIssue[] into human-readable text with icons (✗, ⚠, ℹ), relative paths, truncation (2000 lines / 50KB)
- `summarizeIssues(issues)` — one-line summary ("Lint Results: 2 error(s), 1 warning(s) in 3 file(s)")

**Verify:** `npx tsc --noEmit` passes.

---

## Phase 3: LSP Infrastructure (from pi-lsp, NO tools)

### 3.1 Create `src/lsp-protocol.ts`

**File:** `src/lsp-protocol.ts`

Copy from `../pi-lsp/src/lsp-protocol.ts`, keeping ONLY the types needed for diagnostics:

**Keep:**
- `JsonRpcRequest`, `JsonRpcResponse`, `JsonRpcNotification` — base JSON-RPC types
- `InitializeParams` — for initialization handshake
- `TextDocumentItem` — for didOpen
- `DidChangeTextDocumentParams` — for didChange

**Remove (not needed for pi-lens):**
- `TextDocumentPositionParams`, `ReferenceParams`, `RenameParams`, `WorkspaceSymbolParams`
- `PrepareCallHierarchyParams`, `CallHierarchyIncomingCallsParams`, `CallHierarchyOutgoingCallsParams`
- `PrepareTypeHierarchyParams`, `TypeHierarchyItem`, `TypeHierarchySupertypesParams`, `TypeHierarchySubtypesParams`

**Verify:** `npx tsc --noEmit` passes.

---

### 3.2 Create `src/lsp-client.ts`

**File:** `src/lsp-client.ts`

Copy from `../pi-lsp/src/lsp-client.ts`:
- `LspClient` class (base transport) — process management, JSON-RPC message framing, request/response routing
- `startProcess(config)` — spawn LSP server
- `handleData(data)` — parse incoming LSP data
- `handleMessage(message)` — route responses and notifications
- `sendMessage(message)` — send JSON-RPC to server
- `request<T>(method, params, timeoutMs)` — send request, await response
- `notify(method, params)` — send notification
- Constants: `DEFAULT_REQUEST_TIMEOUT_MS`, `MAX_MESSAGE_SIZE`

**Verify:** `npx tsc --noEmit` passes.

---

### 3.3 Create `src/lsp-client-methods.ts`

**File:** `src/lsp-client-methods.ts`

Copy from `../pi-lsp/src/lsp-client-methods.ts`, keeping ONLY the methods needed for diagnostics:

**Keep:**
- `initialize(config, rootUri)` — LSP initialization handshake
- `didOpen(uri, languageId, version, text)` — open document
- `didChange(uri, version, text)` — notify document change
- `didClose(uri)` — close document (needed for cleanup)
- `requestDiagnostics(uri)` — pull-model diagnostics (LSP 3.17+)
- `shutdown()` — graceful shutdown
- `kill()` — force kill
- `isAlive()` — process liveness check
- Constants: `INITIALIZE_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `FORCE_KILL_DELAY_MS`

**Remove (not needed for pi-lens — no tools):**
- `gotoDefinition`, `findReferences`, `prepareRename`, `rename`, `workspaceSymbol`
- `prepareCallHierarchy`, `incomingCalls`, `outgoingCalls`
- `documentSymbol`, `hover`, `findImplementations`, `findTypeDefinition`
- `prepareTypeHierarchy`, `typeHierarchySupertypes`, `typeHierarchySubtypes`

**Verify:** `npx tsc --noEmit` passes.

---

### 3.4 Create `src/lsp-manager.ts`

**File:** `src/lsp-manager.ts`

Copy from `../pi-lsp/src/lsp-manager.ts`:
- `LspManager` class — server lifecycle management
- `getClientForFile(filePath)` — get/start LSP client for a file
- `getClientForConfig(config)` — get/start LSP client for a config
- `startServer(config)` — start and initialize an LSP server
- `stopServer(language)` — graceful shutdown
- `stopAll()` — shutdown all servers
- `checkIdleServers()` — idle timeout cleanup
- `getDiagnostics(filePath, refresh)` — get diagnostics for a file (pull + push model)
- `handleNotification(language, method, params)` — route server notifications
- `handleDiagnosticsNotification(language, uri, diagnostics)` — cache diagnostics from push notifications
- `ensureFileOpen(client, config, filePath, content)` — open/sync file with server, version tracking, MAX_TRACKED_FILES cap
- `onFileChanged(filePath)` — handle file change (open + trigger diagnostics)
- `getStatus()` — server status summary
- `getAllDiagnostics()` — all cached diagnostics across all servers
- Constants: `IDLE_CHECK_INTERVAL_MS`, `DEFAULT_IDLE_TIMEOUT_MS`
- Helper: `isDiagnosticPullResult()` type guard, `DiagnosticPullResult` interface

**Verify:** `npx tsc --noEmit` passes.

---

### 3.5 Create `src/language-config.ts`

**File:** `src/language-config.ts`

Copy from `../pi-lsp/src/language-config.ts`:
- All 33 `LANGUAGE_SERVERS` entries (typescript, python, rust, go, java, cpp, csharp, php, ruby, lua, html, css, json, yaml, markdown, dart, kotlin, swift, zig, haskell, ocaml, elixir, scala, terraform, dockerfile, sql, vue, svelte, toml, nix, latex, r, bash)
- `languageFromPath(filePath)` — determine language config from file path
- `isServerInstalled(config)` — check if server binary is available

**Verify:** `npx tsc --noEmit` passes.

---

## Phase 4: New pi-lens Modules

### 4.1 Create `src/bash-file-detector.ts`

**File:** `src/bash-file-detector.ts`

**Purpose:** Detect which files are affected by a `bash` tool call by analyzing the command string.

**Implementation:**
```typescript
/**
 * Result of detecting file paths from a bash command
 */
export interface DetectedBashFiles {
  /** Files that were likely created or modified */
  written: string[];
  /** Files that were likely read (informational) */
  read: string[];
}

/**
 * Detect file paths affected by a bash command.
 * Scans for common patterns: sed, cat, echo/tee, perl, awk, python -c, dd, mv, cp, redirect operators
 * Returns absolute paths resolved against cwd.
 */
export function detectFilesFromBashCommand(command: string, cwd: string): DetectedBashFiles;
```

**Regex patterns to implement:**
- `sed -i ... <file>` — modified file
- `sed ... > <file>` — written file via redirect
- `cat > <file>` / `cat >> <file>` — written file
- `echo ... > <file>` / `echo ... >> <file>` — written file
- `tee <file>` — written file
- `perl -i ... <file>` — modified file
- `awk ... > <file>` — written file
- `python -c "..." > <file>` — written file
- `dd of=<file>` — written file
- `mv <src> <dest>` — dest written, src removed
- `cp <src> <dest>` — dest written
- Shell redirect `> <file>` / `>> <file>` — written file

**Implementation notes:**
- Use a list of regex patterns with named captures for the file path
- Handle both single-quoted and double-quoted filenames
- Handle tilde expansion (~/path → resolve)
- Strip trailing semicolons/ampersands
- For multi-command strings (&&, ;, |), split and process each
- Return `{ written: string[], read: string[] }` with absolute paths
- Be conservative: if unsure whether a file is written, include it in `written`

**Verify:** Unit tests cover all patterns. `npx tsc --noEmit` passes.

---

### 4.2 Create `src/prettier-runner.ts`

**File:** `src/prettier-runner.ts`

**Purpose:** Detect prettier configuration and run prettier on changed files.

**Implementation:**
```typescript
export interface PrettierRunResult {
  file: string;
  changed: boolean;
  error?: string;
}

/**
 * Check if prettier is available (npx prettier --version)
 */
export async function isPrettierAvailable(cwd: string): Promise<boolean>;

/**
 * Detect prettier config files in the project
 */
export async function detectPrettierConfig(cwd: string): Promise<string | undefined>;

/**
 * Run prettier --write on the given files
 * Returns per-file results indicating what changed
 */
export async function runPrettier(
  files: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<PrettierRunResult[]>;
```

**Implementation details:**
- `isPrettierAvailable`: run `npx prettier --version` with 10s timeout
- `detectPrettierConfig`: check for `.prettierrc`, `.prettierrc.json`, `.prettierrc.yml`, `.prettierrc.yaml`, `.prettierrc.js`, `.prettierrc.cjs`, `.prettierrc.mjs`, `prettier.config.js`, `prettier.config.cjs`, `prettier.config.mjs`, and `"prettier"` key in `package.json`
- `runPrettier`: exec `npx prettier --write <files>` with 15s timeout, parse stdout line by line. Each line is either `<file> (ms)` (unchanged) or `<file> (ms)` with exit code 0 (changed). Use `--no-error-on-unmatched-pattern` flag.
- Filter files to known prettier-supported extensions: `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.json`, `.jsonc`, `.css`, `.scss`, `.less`, `.html`, `.htm`, `.md`, `.mdx`, `.yaml`, `.yml`, `.vue`, `.svelte`, `.graphql`, `.gql`
- If no config found and no prettier dependency in package.json, skip (return empty)

**Verify:** Unit tests with mocked execCommand. `npx tsc --noEmit` passes.

---

### 4.3 Create `src/tsc-runner.ts`

**File:** `src/tsc-runner.ts`

**Purpose:** Detect TypeScript project and run `tsc --noEmit` on changed files.

**Implementation:**
```typescript
export interface TscRunResult {
  issues: TscIssue[];
  durationMs: number;
  error?: string;
}

/**
 * Check if tsc is available and tsconfig.json exists
 */
export async function isTscAvailable(cwd: string): Promise<boolean>;

/**
 * Detect tsconfig.json in the project (including tsconfig.*.json)
 */
export function detectTsconfig(cwd: string): string | undefined;

/**
 * Run tsc --noEmit and parse diagnostics
 * If files is provided, uses --pretty false and filters output to those files
 */
export async function runTsc(
  cwd: string,
  files?: string[],
  signal?: AbortSignal,
): Promise<TscRunResult>;
```

**Implementation details:**
- `isTscAvailable`: check `tsconfig.json` exists + run `npx tsc --version` with 10s timeout
- `detectTsconfig`: check `fs.existsSync(path.join(cwd, "tsconfig.json"))`, return path or undefined
- `runTsc`: exec `npx tsc --noEmit --pretty false` with 30s timeout. Parse stdout line by line using regex: `^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$`. Map to `TscIssue[]`.
- If `files` parameter is provided, filter parsed issues to only include those files
- Return `{ issues, durationMs, error? }`
- If tsc exits with code 0, return empty issues (clean)
- If exit code is not 0 or 1, and stdout is empty, set error field

**Verify:** Unit tests with mocked execCommand. `npx tsc --noEmit` passes.

---

### 4.4 Create `src/config.ts`

**File:** `src/config.ts`

**Purpose:** Load and validate `.pi-lens.json` configuration file.

**Implementation:**
```typescript
export interface LensConfig {
  /** Enable/disable individual checks */
  prettier: boolean;
  linters: boolean;
  lsp: boolean;
  tsc: boolean;

  /** Custom file patterns to include/exclude */
  includePatterns: string[];  // glob patterns, default: []
  excludePatterns: string[];  // glob patterns, default: ["node_modules/**", ".git/**", "dist/**", "build/**"]

  /** Timing configuration */
  lspDelayMs: number;         // delay before querying LSP diagnostics, default: 1000
  maxConcurrency: number;     // max parallel checks, default: 4

  /** Timeout for individual checks (ms) */
  prettierTimeoutMs: number;  // default: 15000
  linterTimeoutMs: number;    // default: 15000
  tscTimeoutMs: number;       // default: 30000

  /** Bash file detection */
  bashDetection: boolean;     // default: true

  /** Report status even when all clean */
  alwaysReport: boolean;      // default: true
}

export const DEFAULT_CONFIG: LensConfig;

/**
 * Load .pi-lens.json from cwd, merging with defaults
 */
export function loadConfig(cwd: string): LensConfig;
```

**Implementation details:**
- `DEFAULT_CONFIG` provides all defaults
- `loadConfig`: read `.pi-lens.json` from cwd, JSON.parse, merge with defaults using spread
- If file doesn't exist, return DEFAULT_CONFIG
- If file is malformed JSON, warn to console and return DEFAULT_CONFIG
- Validate that all values are of expected types; ignore unknown keys

**Verify:** Unit tests for default config, file loading, JSON error handling. `npx tsc --noEmit` passes.

---

### 4.5 Create `src/hook-runner.ts`

**File:** `src/hook-runner.ts`

**Purpose:** Main orchestrator — detects changed files, runs checks in order, formats results for the agent.

**Implementation:**
```typescript
export interface HookResult {
  /** Formatted text to append to tool result */
  text: string;
  /** Per-check statuses for status bar */
  statuses: {
    prettier: CheckStatus;
    linters: CheckStatus;
    lsp: CheckStatus;
    tsc: CheckStatus;
  };
  /** Total duration */
  durationMs: number;
}

/**
 * Resolve file paths from a tool_result event
 */
export function resolveFilesFromToolResult(
  toolName: string,
  input: Record<string, unknown>,
  cwd: string,
): string[];

/**
 * Run all checks on the given files and return formatted results
 * Checks run in order: prettier → linters → LSP diagnostics → tsc
 */
export async function runChecks(
  files: string[],
  cwd: string,
  config: LensConfig,
  state: LensState,
  signal?: AbortSignal,
): Promise<HookResult>;

/**
 * Format a clean result message
 */
export function formatCleanMessage(files: string[], durationMs: number): string;

/**
 * Format check results into agent-readable text
 */
export function formatHookResult(result: HookResult, cwd: string): string;
```

**LensState interface (shared with index.ts):**
```typescript
export interface LensState {
  detectedLinters: DetectedLinter[];
  lspManager: LspManager | null;
  config: LensConfig;
  cwd: string;
}
```

**`resolveFilesFromToolResult` logic:**
- For `write`/`edit`: extract `input.path`, resolve to absolute
- For `bash`: call `detectFilesFromBashCommand(input.command, cwd)` and return `written` files
- Filter to existing files (stat check)
- Deduplicate

**`runChecks` logic:**
1. **Prettier** — if `config.prettier && await isPrettierAvailable(cwd)`:
   - Filter files to prettier-supported extensions
   - Run `runPrettier(files, cwd, signal)`
   - Report changed/unchanged files
2. **Linters** — if `config.linters && state.detectedLinters.length > 0`:
   - Get relevant linters for each file
   - Run `runLinters(linters, files, cwd, signal)`
   - Report issues via `formatIssues` + `summarizeIssues`
3. **LSP Diagnostics** — if `config.lsp && state.lspManager`:
   - For each file with a known language config:
     - Call `lspManager.onFileChanged(filePath)`
   - Wait `config.lspDelayMs` (default 1000ms)
   - Collect diagnostics via `lspManager.getDiagnostics(filePath, true)`
   - Report issues count per file
4. **TSC** — if `config.tsc && await isTscAvailable(cwd)`:
   - Filter files to TS/JS extensions (`.ts`, `.tsx`, `.js`, `.jsx`)
   - Run `runTsc(cwd, files, signal)`
   - Report issues

**Output format:**
```
🔍 pi-lens: <file count> file(s) checked (Xms)
  ✅ prettier: 3 file(s) formatted
  ⚠ linters: 2 warning(s) in 1 file(s)
    ⚠ src/foo.ts:10:5: Unexpected any (no-explicit-any) [eslint]
  ✅ lsp: 0 diagnostics
  ✅ tsc: 0 errors
```

Or when all clean:
```
🔍 pi-lens: 1 file(s) checked — all clean (234ms)
```

**Verify:** Unit tests with mocked dependencies. `npx tsc --noEmit` passes.

---

## Phase 5: Extension Entry Point

### 5.1 Create `src/index.ts`

**File:** `src/index.ts`

**Purpose:** Extension entry point — session lifecycle, hook registration, status publishing.

**Implementation:**
```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detectLinters, getLintersForFile } from "./linter-registry.js";
import { LspManager, DEFAULT_IDLE_TIMEOUT_MS } from "./lsp-manager.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { resolveFilesFromToolResult, runChecks, formatHookResult } from "./hook-runner.js";
import type { LensConfig, LensState, CheckStatus, LensStatusPayload } from "./types.js";

export default function (pi: ExtensionAPI) {
  const state: LensState = {
    detectedLinters: [],
    lspManager: null,
    config: DEFAULT_CONFIG,
    cwd: process.cwd(),
  };

  let currentCtx: ExtensionContext | undefined;
  let lastStatus: string | undefined;

  // ── Session Lifecycle ──────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    state.cwd = ctx.cwd;
    currentCtx = ctx;
    state.config = loadConfig(ctx.cwd);

    // Initialize LSP manager
    state.lspManager = new LspManager(ctx.cwd, DEFAULT_IDLE_TIMEOUT_MS);

    // Detect linters in parallel
    state.detectedLinters = await detectLinters(ctx.cwd);

    if (ctx.hasUI) {
      const linterNames = state.detectedLinters.map((l) => l.definition.label).join(", ");
      ctx.ui.notify(
        `pi-lens: ready${state.detectedLinters.length > 0 ? ` — linters: ${linterNames}` : ""}`,
        "info",
      );
    }
    publishStatus();
  });

  pi.on("session_shutdown", async () => {
    if (state.lspManager) {
      await state.lspManager.stopAll();
      state.lspManager = null;
    }
    if (currentCtx?.hasUI) {
      currentCtx.ui.setStatus("pi-lens", undefined);
    }
    state.detectedLinters = [];
    currentCtx = undefined;
    lastStatus = undefined;
  });

  // ── Hook: tool_result ─────────────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    // Only hook write, edit, bash
    if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash")
      return;

    // Don't process error results
    if (event.isError) return;

    // Resolve affected files
    const input = event.input as Record<string, unknown>;
    const files = resolveFilesFromToolResult(event.toolName, input, ctx.cwd);

    if (files.length === 0) return;

    try {
      const result = await runChecks(files, ctx.cwd, state.config, state, ctx.signal);

      // Update status bar
      updateStatuses(result.statuses);
      publishStatus();

      // Always report (even when clean, per config.alwaysReport)
      if (result.text) {
        return {
          content: [...event.content, { type: "text" as const, text: result.text }],
        };
      }
    } catch {
      // Never block the original tool result
    }
    return undefined;
  });

  // ── Status Publishing ─────────────────────────────────────────

  function publishStatus(): void {
    if (!currentCtx?.hasUI) return;
    // ... build LensStatusPayload, compare with lastStatus, call ui.setStatus
  }
}
```

**Key design decisions:**
- **Single `tool_result` hook** handles all three tool types (write, edit, bash)
- **Always reports** — even when clean, returns a brief "all clean" message
- **Error swallowing** — hook failures never block the original tool result
- **Unified status bar** — publishes a single `pi-lens` status combining all check statuses
- **No tools registered** — pi-lens is hook-only (no explicit tools for the agent to call)
- **No coexistence handling** — doesn't check for or coordinate with pi-lint/pi-lsp

**Verify:** `npx tsc --noEmit` passes. Extension loads in pi without errors.

---

## Phase 6: Tests

### 6.1 Create test setup

**File:** `src/__tests__/setup.ts`

```typescript
import { vi } from "vitest";

// Mock typebox
vi.mock("typebox", () => ({
  Type: {
    Object: vi.fn((props: Record<string, unknown>) => props),
    String: vi.fn((opts?: Record<string, unknown>) => opts ?? {}),
    Array: vi.fn((item: Record<string, unknown>, opts?: Record<string, unknown>) => ({
      items: item,
      ...(opts ?? {}),
    })),
    Optional: vi.fn((schema: Record<string, unknown>) => schema),
  },
}));

// Mock child_process for all tests
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  execFile: vi.fn(),
  execSync: vi.fn(),
}));
```

**Verify:** Test framework initializes without errors.

---

### 6.2 Create parser tests

**File:** `src/__tests__/parsers.test.ts`

Copy from `../pi-lint/src/__tests__/parsers.test.ts` — tests for all 11 parsers:
- Each parser tested with: empty input, valid multi-issue JSON, invalid JSON, edge cases (null values, missing fields)
- Inline `JSON.stringify()` fixtures for linter stdout
- Special format tests: Flake8 tab-separated, Mypy NDJSON, Clippy NDJSON, staticcheck dual format

**Verify:** `npx vitest run src/__tests__/parsers.test.ts` passes.

---

### 6.3 Create linter-registry tests

**File:** `src/__tests__/linter-registry.test.ts`

Copy from `../pi-lint/src/__tests__/linter-registry.test.ts`:
- Mock `fs.existsSync`, `fs.readFileSync` for config file detection
- Mock `child_process.spawn` for version command verification
- Test: detection via config files, package.json keys, pyproject.toml sections, project markers
- Test: `getLintersForFile` extension filtering
- Test: `discoverFilesNative` with mocked `fs.promises.readdir`
- Test: parallel version check failures

**Verify:** `npx vitest run src/__tests__/linter-registry.test.ts` passes.

---

### 6.4 Create linter-runner tests

**File:** `src/__tests__/linter-runner.test.ts`

Copy from `../pi-lint/src/__tests__/linter-runner.test.ts`:
- Test `formatIssues` — icons, relative paths, truncation at 2000 lines and 50KB
- Test `summarizeIssues` — one-line summary with error/warning/info counts
- Test `runLinter` — mocked spawn, stdout parsing
- Test `runLinters` — parallel execution with multiple linters

**Verify:** `npx vitest run src/__tests__/linter-runner.test.ts` passes.

---

### 6.5 Create LSP client tests

**File:** `src/__tests__/lsp-client.test.ts`

Copy from `../pi-lsp/tests/unit/lsp-client.test.ts`:
- Test `LspClient` base class: message framing, Content-Length parsing, buffer handling
- Test request/response routing with pending requests map
- Test notification handling
- Test timeout behavior
- Test oversized message dropping
- Test process error/exit handling

**Verify:** `npx vitest run src/__tests__/lsp-client.test.ts` passes.

---

### 6.6 Create LSP client-methods tests

**File:** `src/__tests__/lsp-client-methods.test.ts`

Copy from `../pi-lsp/tests/unit/lsp-client-methods.test.ts`, keeping ONLY diagnostics-related tests:
- Test `initialize` — sends correct InitializeParams, handles timeout
- Test `didOpen` / `didChange` / `didClose` — correct notification format
- Test `requestDiagnostics` — pull model request
- Test `shutdown` — graceful shutdown sequence
- Test `kill` — force kill
- Test `isAlive` — liveness check

**Verify:** `npx vitest run src/__tests__/lsp-client-methods.test.ts` passes.

---

### 6.7 Create LSP manager tests

**File:** `src/__tests__/lsp-manager.test.ts`

Copy from `../pi-lsp/tests/unit/lsp-manager.test.ts`:
- Test server lifecycle: start, stop, stopAll
- Test `getClientForFile` — starts server on demand
- Test `getDiagnostics` — push and pull model
- Test `ensureFileOpen` — version tracking, file cap
- Test `handleDiagnosticsNotification` — cache updates
- Test idle timeout cleanup
- Test dead process detection and restart

**Verify:** `npx vitest run src/__tests__/lsp-manager.test.ts` passes.

---

### 6.8 Create language-config tests

**File:** `src/__tests__/language-config.test.ts`

Copy from `../pi-lsp/tests/unit/language-config.test.ts`:
- Test `languageFromPath` for all 33 languages
- Test edge cases: no extension, unknown extension, Dockerfile (bare filename)
- Test `isServerInstalled` with mocked execFile

**Verify:** `npx vitest run src/__tests__/language-config.test.ts` passes.

---

### 6.9 Create bash-file-detector tests

**File:** `src/__tests__/bash-file-detector.test.ts`

New tests for `detectFilesFromBashCommand`:
- Test `sed -i 's/old/new/g' file.txt` → writes file.txt
- Test `sed 's/old/new/g' input.txt > output.txt` → writes output.txt
- Test `cat > file.txt << EOF ... EOF` → writes file.txt
- Test `echo "hello" > file.txt` → writes file.txt
- Test `echo "hello" >> file.txt` → writes file.txt
- Test `tee output.txt` → writes output.txt
- Test `perl -i -pe 's/old/new/g' file.pl` → writes file.pl
- Test `awk '{print $1}' input.txt > output.txt` → writes output.txt
- Test `python -c "..." > output.txt` → writes output.txt
- Test `dd if=input.bin of=output.bin` → writes output.bin
- Test `mv old.txt new.txt` → writes new.txt
- Test `cp src.txt dest.txt` → writes dest.txt
- Test multi-command: `echo "a" > a.txt && echo "b" > b.txt` → writes both
- Test empty command → returns empty arrays
- Test command with no file operations → returns empty arrays
- Test relative path resolution against cwd
- Test tilde expansion

**Verify:** `npx vitest run src/__tests__/bash-file-detector.test.ts` passes.

---

### 6.10 Create prettier-runner tests

**File:** `src/__tests__/prettier-runner.test.ts`

New tests:
- Test `isPrettierAvailable` — mocked exec returns version string → true
- Test `isPrettierAvailable` — mocked exec fails → false
- Test `detectPrettierConfig` — finds `.prettierrc` → returns path
- Test `detectPrettierConfig` — no config files → returns undefined
- Test `detectPrettierConfig` — finds `prettier` key in package.json → returns package.json path
- Test `runPrettier` — mocked exec returns unchanged output → all `changed: false`
- Test `runPrettier` — mocked exec returns changed output → corresponding files `changed: true`
- Test `runPrettier` — filters to supported extensions only
- Test `runPrettier` — handles exec error gracefully
- Test `runPrettier` — respects AbortSignal

**Verify:** `npx vitest run src/__tests__/prettier-runner.test.ts` passes.

---

### 6.11 Create tsc-runner tests

**File:** `src/__tests__/tsc-runner.test.ts`

New tests:
- Test `isTscAvailable` — tsconfig.json exists + tsc version succeeds → true
- Test `isTscAvailable` — no tsconfig.json → false
- Test `isTscAvailable` — tsc not installed → false
- Test `detectTsconfig` — finds tsconfig.json → returns path
- Test `detectTsconfig` — no tsconfig.json → undefined
- Test `runTsc` — clean output (exit 0) → empty issues
- Test `runTsc` — parses error lines: `src/foo.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'`
- Test `runTsc` — parses warning lines
- Test `runTsc` — filters to specific files when `files` param provided
- Test `runTsc` — handles malformed output lines (skips them)
- Test `runTsc` — handles exec timeout
- Test `runTsc` — handles non-zero exit with empty stdout → sets error field

**Verify:** `npx vitest run src/__tests__/tsc-runner.test.ts` passes.

---

### 6.12 Create config tests

**File:** `src/__tests__/config.test.ts`

New tests:
- Test `DEFAULT_CONFIG` has all expected fields with correct defaults
- Test `loadConfig` — no `.pi-lens.json` → returns defaults
- Test `loadConfig` — valid `.pi-lens.json` → merges with defaults
- Test `loadConfig` — partial config → only overrides specified fields
- Test `loadConfig` — malformed JSON → returns defaults (warns)
- Test `loadConfig` — unknown keys → ignored, defaults used for known keys
- Test `loadConfig` — wrong types → defaults used for those fields

**Verify:** `npx vitest run src/__tests__/config.test.ts` passes.

---

### 6.13 Create hook-runner tests

**File:** `src/__tests__/hook-runner.test.ts`

New tests:
- Test `resolveFilesFromToolResult` — write tool with absolute path → returns [path]
- Test `resolveFilesFromToolResult` — write tool with relative path → resolves against cwd
- Test `resolveFilesFromToolResult` — edit tool → returns [path]
- Test `resolveFilesFromToolResult` — bash tool with sed → returns written files
- Test `resolveFilesFromToolResult` — bash tool with no file ops → returns []
- Test `resolveFilesFromToolResult` — unknown tool → returns []
- Test `runChecks` — all checks disabled → returns clean message
- Test `runChecks` — prettier only → runs prettier, reports results
- Test `runChecks` — linters only → runs linters, reports issues
- Test `runChecks` — LSP only → runs diagnostics, reports results
- Test `runChecks` — tsc only → runs tsc, reports issues
- Test `runChecks` — all checks, all clean → "all clean" message
- Test `runChecks` — mixed results → formatted with sections
- Test `formatCleanMessage` — correct format
- Test `formatHookResult` — correct multiline format with icons
- Test hook timeout behavior — signal aborted mid-check

**Verify:** `npx vitest run src/__tests__/hook-runner.test.ts` passes.

---

### 6.14 Create index tests

**File:** `src/__tests__/index.test.ts`

New tests:
- Test extension loads without error (default export is a function)
- Test `session_start` — detects linters, initializes LSP manager, publishes status
- Test `session_shutdown` — stops LSP manager, clears state
- Test `tool_result` hook — write tool triggers checks
- Test `tool_result` hook — edit tool triggers checks
- Test `tool_result` hook — bash tool triggers checks
- Test `tool_result` hook — read tool ignored
- Test `tool_result` hook — error results skipped
- Test `tool_result` hook — returns appended content with check results
- Test `tool_result` hook — clean results still reported (alwaysReport: true)
- Test `tool_result` hook — error swallowing (failed checks don't block tool result)
- Test status publishing — updates on session_start and after each check
- Mock ExtensionAPI, detectLinters, LspManager, runChecks

**Verify:** `npx vitest run src/__tests__/index.test.ts` passes.

---

### 6.15 Create spawn-utils tests

**File:** `src/__tests__/spawn-utils.test.ts`

Tests for `execCommand`:
- Test successful execution → returns stdout, stderr, exitCode 0
- Test non-zero exit code → returns exitCode
- Test timeout → returns exitCode -1
- Test maxBuffer exceeded → returns truncated stdout, exitCode -1
- Test AbortSignal → kills process, returns exitCode -1
- Test process error → returns error message in stderr

**Verify:** `npx vitest run src/__tests__/spawn-utils.test.ts` passes.

---

### 6.16 Verify full test suite

**Command:** `npx vitest run`

All tests pass. Coverage ≥ 90% for statements, branches, functions, lines.

**Command:** `npx vitest run --coverage`

Verify coverage thresholds are met.

---

## Phase 7: Documentation and Polish

### 7.1 Write full `README.md`

**File:** `README.md`

Replace placeholder with full documentation:
- **Overview** — what pi-lens does, how it differs from pi-lint and pi-lsp
- **Features** — auto-prettier, auto-linting, LSP diagnostics, tsc checking, bash file detection
- **Installation** — npm install + pi configuration
- **Configuration** — `.pi-lens.json` schema with all options and defaults
- **Supported linters** — table of 11 linters (copy from pi-lint README)
- **Supported LSP servers** — table of 33 languages (copy from pi-lsp README)
- **How it works** — hook flow diagram: tool_result → detect files → run checks → report
- **Status bar** — description of unified status display
- **Comparison with pi-lint/pi-lsp** — note that pi-lens replaces both for hook-only usage

**Verify:** README is complete and accurate.

---

### 7.2 Create `docs/architecture.md`

**File:** `docs/architecture.md`

Document the architecture:
- **Module dependency graph** — types.ts ← spawn-utils.ts ← definitions.ts/parsers.ts ← linter-registry.ts ← linter-runner.ts ← output-formatter.ts, and lsp-protocol.ts ← lsp-client.ts ← lsp-client-methods.ts ← lsp-manager.ts ← language-config.ts
- **Data flow** — tool_result event → hook-runner → individual runners → output formatter → tool_result modification
- **State management** — LensState singleton, session lifecycle
- **LSP server lifecycle** — lazy start, idle timeout, diagnostics cache
- **Check execution order** — prettier (mutates files) → linters → LSP diagnostics → tsc

**Verify:** Document is clear and matches implementation.

---

### 7.3 Create `docs/configuration.md`

**File:** `docs/configuration.md`

Detailed configuration reference:
- `.pi-lens.json` file format
- Each config option: type, default, description, example
- Example configurations: minimal, full, prettier-only, linting-only
- How to disable specific checks

**Verify:** Document covers all config options from `src/config.ts`.

---

### 7.4 Create `docs/adding-checks.md`

**File:** `docs/adding-checks.md`

Guide for adding new check types:
- Create a new runner module (e.g., `src/new-check-runner.ts`)
- Add new types to `src/types.ts` (CheckStatus variant, result interface)
- Integrate into `src/hook-runner.ts` (add step in runChecks)
- Add config option to `src/config.ts`
- Add tests
- Update status bar payload

**Verify:** Document provides a clear step-by-step guide.

---

### 7.5 Create `skills/lens-hooks/SKILL.md`

**File:** `skills/lens-hooks/SKILL.md`

Skill file for the pi agent:
```markdown
# pi-lens Auto-Checks

## When to use
This skill activates automatically after write, edit, and bash tool calls.

## What it does
pi-lens automatically runs code quality checks on changed files:
1. Prettier formatting
2. Linter checks (ESLint, Biome, Ruff, etc.)
3. LSP diagnostics
4. TypeScript type checking

## How to interpret results
- ✅ = check passed (clean)
- ⚠ = warnings found
- ✗ = errors found

## Agent guidelines
- If pi-lens reports errors, fix them before continuing
- Warnings are informational but should be addressed
- prettier auto-formats files — the file content has already been updated
```

**Verify:** Skill file follows pi skill conventions.

---

### 7.6 Create `CHANGELOG.md`

**File:** `CHANGELOG.md`

```markdown
# Changelog

## [1.0.0] - 2025-XX-XX

### Added
- Initial release
- Auto-run prettier on changed files
- Auto-run linters on changed files (11 linters supported)
- Auto-run LSP diagnostics on changed files (33 languages supported)
- Auto-run tsc --noEmit on changed TypeScript files
- Bash command file detection (sed, cat, echo, tee, perl, awk, python, dd, mv, cp)
- Unified status bar for all checks
- Configurable via .pi-lens.json
```

**Verify:** File exists.

---

### 7.7 Create `CONTRIBUTING.md`

**File:** `CONTRIBUTING.md`

Adapt from `../pi-lint/CONTRIBUTING.md`:
- Prerequisites (Node >= 20)
- Setup (clone, npm install)
- npm scripts table (test, lint, typecheck, format, etc.)
- Pre-PR checklist (all four checks must pass)
- Project structure
- Module responsibilities (updated for pi-lens)
- Testing patterns (Vitest, mocking strategy)
- Coverage thresholds (90%)
- PR guidelines

**Verify:** Document is complete and accurate for pi-lens.

---

### 7.8 Final lint/typecheck/test/coverage pass

**Commands:**
```bash
npm run format          # Auto-fix formatting
npm run format:check    # Verify clean
npm run lint            # ESLint
npm run lint:fix        # Auto-fix lint issues
npm run typecheck       # TypeScript
npm run test:coverage   # Full test suite with coverage
```

**All must pass with zero errors.** Coverage must meet 90% thresholds.

**Verify:** All four CI checks pass locally before pushing.
