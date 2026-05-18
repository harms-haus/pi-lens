# Contributing to pi-lens

Thank you for your interest in contributing to pi-lens! This guide covers how to set up the project, run tests, and submit changes.

## Introduction

pi-lens is a [pi](https://github.com/earendil-works/pi-coding-agent) extension that unifies code quality checks into a single post-tool hook. It provides:

- **Auto-checking** — runs prettier, linters, LSP diagnostics, and tsc after every `write`/`edit`/`bash` tool call
- **Prettier report-only** — detects files needing formatting without modifying them
- **11 linter support** — auto-detects and runs ESLint, Biome, Ruff, Flake8, Pylint, Mypy, Clippy, staticcheck, RuboCop, ShellCheck, and Stylelint
- **LSP diagnostics** — manages language server lifecycle for 30+ languages
- **TypeScript checking** — runs `tsc --noEmit` on changed files

The codebase is ~2,500 lines of TypeScript (ESM) with zero build step — pi loads `.ts` files directly at runtime.

We welcome contributions in all forms: bug reports, new check types, parser improvements, documentation, and test coverage enhancements.

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| **Node.js** | >= 20 | Runtime for pi and the extension |
| **npm** | latest (bundled with Node.js) | Package management |
| **pi dev environment** *(optional)* | — | Integration testing with the actual pi agent |

No build toolchain (webpack, esbuild, etc.) is required. TypeScript is loaded at runtime.

## Setup

```bash
# Clone the repository
git clone https://github.com/harms-haus/pi-lens.git
cd pi-lens

# Install dependencies
npm install
```

That's it — there is no build step. pi loads `src/index.ts` directly at runtime.

For type checking only (no output files are produced):

```bash
npx tsc --noEmit
```

## Development Workflow

### npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `test` | `vitest run` | Run all tests once |
| `test:watch` | `vitest` | Run tests in watch mode |
| `test:coverage` | `vitest run --coverage` | Run tests with coverage report |
| `lint` | `eslint src/` | Run ESLint 9 on all source files |
| `lint:fix` | `eslint --fix src/` | Run ESLint with auto-fix |
| `typecheck` | `tsc --noEmit` | Type-check without emitting files |
| `format` | `prettier --write src/` | Format source files in place |
| `format:check` | `prettier --check src/` | Check formatting without modifying files |

### Pre-PR Checklist

Before submitting a pull request, **all four checks must pass**:

```bash
npm run test        # Vitest — no failures
npm run lint        # ESLint — no errors or warnings
npm run typecheck   # TypeScript — no type errors
npm run format:check # Prettier — no formatting issues
```

Run `npm run format` to auto-fix any formatting violations, then re-check.

## Project Structure

```
pi-lens/
├── src/
│   ├── index.ts                 # Extension entry point — registers session lifecycle hooks and the tool_result hook
│   ├── types.ts                 # Core interfaces: LensConfig, LintIssue, LspServerConfig, TscIssue, CheckStatus
│   ├── config.ts                # Configuration loading: reads .pi-lens.json, merges with defaults, validates types
│   ├── hook-runner.ts           # Main orchestrator: resolves files from tool results, runs checks in sequence
│   ├── prettier-runner.ts       # Prettier runner: report-only --check, never writes
│   ├── tsc-runner.ts            # TypeScript compiler runner: tsc --noEmit with output parsing
│   ├── bash-file-detector.ts    # Bash command analyzer: detects file-writing patterns in command strings
│   ├── definitions.ts           # Linter blueprints — command strings, config files, parsers, and timeouts
│   ├── parsers.ts               # 11 output parsers, one per linter; normalizes stdout into LintIssue[]
│   ├── linter-registry.ts       # Linter detection pipeline: config files, package.json, project markers
│   ├── linter-runner.ts         # Linter execution: process spawning, parallel runs, result formatting
│   ├── output-formatter.ts      # Unified output formatting: icons, relative paths, truncation, severity counts
│   ├── spawn-utils.ts           # Shared process spawning utilities: execCommand with timeout and buffer caps
│   ├── language-config.ts       # LSP language server configurations for 30+ languages
│   ├── lsp-manager.ts           # LSP server lifecycle manager: start, stop, idle timeout, diagnostics cache
│   ├── lsp-client.ts            # Low-level LSP JSON-RPC client: process management, message framing
│   ├── lsp-client-methods.ts    # High-level LSP protocol methods: initialize, didOpen, didChange, diagnostics
│   ├── lsp-protocol.ts          # LSP protocol constants and type definitions
│   └── __tests__/
│       ├── setup.ts                 # Shared test setup and helpers
│       ├── helpers/
│       │   ├── fixtures.ts                # Shared test fixtures (mock configs, sample outputs)
│       │   └── create-client-with-mock.ts  # LSP client factory with mock transport
│       ├── index.test.ts            # Tests for the extension entry point
│       ├── config.test.ts           # Tests for configuration loading
│       ├── hook-runner.test.ts      # Tests for the hook orchestrator
│       ├── prettier-runner.test.ts  # Tests for prettier integration
│       ├── tsc-runner.test.ts       # Tests for tsc integration
│       ├── bash-file-detector.test.ts # Tests for bash command analysis
│       ├── parsers.test.ts          # Tests for all 11 linter parsers
│       ├── definitions.test.ts      # Tests for linter definitions
│       ├── linter-registry.test.ts  # Tests for linter detection
│       ├── linter-runner.test.ts    # Tests for linter execution
│       ├── spawn-utils.test.ts      # Tests for process spawning utilities
│       ├── language-config.test.ts  # Tests for language server configurations
│       ├── lsp-client.test.ts       # Tests for the LSP JSON-RPC client
│       ├── lsp-client-methods.test.ts # Tests for LSP protocol methods
│       └── lsp-manager.test.ts      # Tests for LSP server lifecycle
├── skills/
│   └── lens-hooks/
│       └── SKILL.md             # Prompt skill for the pi agent (check guidelines)
├── docs/
│   ├── architecture.md          # Technical architecture deep-dive
│   ├── configuration.md         # Configuration reference
│   └── adding-checks.md         # Guide for adding new check types
├── package.json                 # Project metadata, scripts, dependencies
├── tsconfig.json                # TypeScript config (ES2020 target, ESNext modules, strict mode)
├── vitest.config.ts             # Vitest configuration
├── README.md                    # User-facing documentation
├── CHANGELOG.md                 # Version history
└── LICENSE                      # MIT License
```

### Module Responsibilities

- **`index.ts`** — Default export function receiving `ExtensionAPI`. Manages session lifecycle (`session_start`/`session_shutdown`), detects linters/prettier/tsc availability on session start, and installs the `tool_result` hook that triggers pi-lens checks. Publishes status bar updates.
- **`types.ts`** — Defines all shared interfaces: `LensConfig` (configuration), `LintIssue` (normalized lint output), `LinterDefinition`/`DetectedLinter` (linter infrastructure), `LspServerConfig`/`LspServerInstance` (LSP management), `PrettierResult`/`TscIssue` (check-specific types), and `CheckStatus`/`LensStatusPayload` (status bar).
- **`config.ts`** — Exports `loadConfig(cwd)` and `DEFAULT_CONFIG`. Reads `.pi-lens.json`, parses JSON, validates types per key (boolean, number, string array), and silently ignores unknown or mistyped keys.
- **`hook-runner.ts`** — The orchestrator. `resolveFilesFromToolResult()` extracts file paths from tool events. `runChecks()` runs the four check types in sequence (prettier → linters → LSP → tsc), collects formatted sections, and returns a `HookResult` with text, statuses, and duration.
- **`prettier-runner.ts`** — `isPrettierAvailable()` checks for prettier installation. `runPrettier()` executes `npx prettier --check` on each file and returns `PrettierResult[]` with changed/error status. Never writes files.
- **`tsc-runner.ts`** — `isTscAvailable()` checks for TypeScript installation. `runTsc()` runs `tsc --noEmit` and parses the output into `TscIssue[]`. Filters results to only the provided files.
- **`bash-file-detector.ts`** — Analyzes bash command strings for file-writing patterns: sed, cat, echo, tee, perl, awk, python -c, dd, mv, cp, and shell redirects. Returns `{ written: string[], read: string[] }`. Best-effort — documented limitations include variable expansion, subshells, and eval.
- **`definitions.ts`** — Exports `LINTER_DEFINITIONS` with all 11 linter configurations: languages, extensions, config files, version/lint commands, parser references, and timeouts.
- **`parsers.ts`** — 11 `parse*Output` functions. Most parse JSON output; Flake8 and Mypy use custom formats (tab-separated and NDJSON). All gracefully handle malformed input by returning `[]`.
- **`linter-registry.ts`** — Detection engine: scans for config files, `pyproject.toml` sections, `package.json` dependencies, and project markers. Verifies installation via parallel `versionCommand` execution.
- **`linter-runner.ts`** — Spawns linter processes via `execCommand` with timeout handling and buffer caps. Runs linters on files, returns `LintIssue[]`.
- **`output-formatter.ts`** — Formats `LintIssue[]` into human-readable output with icons (⚠/✗/ℹ), relative paths, truncation (2,000 lines / 50KB), and severity counts.
- **`spawn-utils.ts`** — `execCommand()` utility: wraps `child_process.spawn` with environment sanitization, timeout, buffer caps, and AbortSignal support.
- **`language-config.ts`** — `LANGUAGE_SERVERS` array with 30+ `LspServerConfig` entries. Each defines command, args, extensions, detect/install commands.
- **`lsp-manager.ts`** — `LspManager` class: manages LSP server lifecycle. Auto-starts servers on demand, caches diagnostics, stops idle servers after configurable timeout.
- **`lsp-client.ts`** — Low-level JSON-RPC client over stdio. Handles process spawning, message framing (Content-Length header), request/response correlation.
- **`lsp-client-methods.ts`** — High-level LSP protocol methods: `initialize`, `textDocument/didOpen`, `textDocument/didChange`, `textDocument/diagnostics`.
- **`lsp-protocol.ts`** — LSP protocol constants (message types, error codes, capability flags).

## Testing Patterns

### Framework

Tests use [Vitest](https://vitest.dev/) with `describe` / `it` / `expect` from the `vitest` package. Test files follow the `*.test.ts` convention and live in `src/__tests__/`.

### Running Tests

```bash
# Run all tests
npm test

# Run a single test file
npx vitest run src/__tests__/hook-runner.test.ts

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Mocking Strategy

Tests mock Node.js built-in modules at the module level using `vi.mock()`:

```typescript
// Mock fs operations
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: { readdir: vi.fn() },
}));

// Mock child_process for process execution
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock project-internal modules
vi.mock("../linter-registry.js", () => ({
  getLintersForFile: vi.fn(),
}));
```

Tests then import the mocked modules and access typed mock functions via `vi.mocked()`:

```typescript
import * as fs from "node:fs";
const mockedExistsSync = vi.mocked(fs.existsSync);
```

### Test Data

- **Parser tests** use inline `JSON.stringify()` fixtures to simulate linter stdout. Each parser is tested with: empty/zero-result input, valid multi-issue input, invalid JSON, and format-specific edge cases.
- **Config tests** mock `fs.readFileSync` to simulate config file contents — valid JSON, malformed JSON, missing files, and unknown keys.
- **Hook-runner tests** mock linter/LSP/tsc/prettier runners to verify orchestration order, status tracking, and output formatting.
- **LSP tests** mock the child process spawn to simulate server communication.

### Test Coverage by Module

| Test File | Source Module | Focus |
|-----------|--------------|-------|
| `index.test.ts` | `index.ts` | Session lifecycle, hook registration, status bar updates |
| `config.test.ts` | `config.ts` | Config loading, defaults, malformed JSON, unknown keys |
| `hook-runner.test.ts` | `hook-runner.ts` | File resolution, check pipeline, formatting, error handling |
| `prettier-runner.test.ts` | `prettier-runner.ts` | Availability detection, prettier execution, result parsing |
| `tsc-runner.test.ts` | `tsc-runner.ts` | Availability detection, tsc execution, output parsing |
| `bash-file-detector.test.ts` | `bash-file-detector.ts` | Command analysis patterns, edge cases, limitations |
| `parsers.test.ts` | `parsers.ts` | All 11 parsers: JSON parsing, fallbacks, edge cases |
| `definitions.test.ts` | `definitions.ts` | Linter definition structure validation |
| `linter-registry.test.ts` | `linter-registry.ts` | Detection via config files, package.json, pyproject sections |
| `linter-runner.test.ts` | `linter-runner.ts` | Linter execution, issue collection |
| `spawn-utils.test.ts` | `spawn-utils.ts` | Process spawning, timeout, buffer caps |
| `language-config.test.ts` | `language-config.ts` | Language server config structure validation |
| `lsp-client.test.ts` | `lsp-client.ts` | JSON-RPC message framing, request/response |
| `lsp-client-methods.test.ts` | `lsp-client-methods.ts` | LSP protocol methods |
| `lsp-manager.test.ts` | `lsp-manager.ts` | Server lifecycle, idle timeout, diagnostics cache |

## Pull Request Guidelines

### Requirements

- All four checks must pass: `test`, `lint`, `typecheck`, `format:check`
- Use descriptive commit messages
- Keep PRs focused — one feature or bug fix per PR

### PR Description

Include the following in your PR description:

1. **What changed** — brief summary of the modification
2. **Why** — motivation or problem being solved
3. **Which checks affected** — list any check types whose behavior changed (or "none" if infrastructure-only)

### New Check Type Additions

When adding a new check type:

1. Create the runner module in `src/`
2. Add types to `src/types.ts`
3. Integrate into `src/hook-runner.ts`
4. Add a config option to `src/config.ts`
5. Add tests in `src/__tests__/`
6. Update documentation

See [docs/adding-checks.md](docs/adding-checks.md) for a step-by-step guide.

### Bug Fixes

Bug fix PRs should include a test case that reproduces the issue and verifies the fix. If a bug was reported without a test, adding one is strongly encouraged.

## License

By contributing to pi-lens, you agree that your contributions will be licensed under the [MIT License](LICENSE).
