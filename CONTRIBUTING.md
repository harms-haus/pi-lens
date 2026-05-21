# Contributing to pi-lens

Thank you for your interest in contributing to pi-lens! This guide covers how to set up the project, run tests, and submit changes.

## Introduction

pi-lens is a [pi](https://github.com/earendil-works/pi-coding-agent) extension that unifies code quality checks into a single post-tool hook. It acts as a thin client for the [`@harms-haus/code-lens`](https://github.com/harms-haus/code-lens) daemon, which handles all check execution (prettier, linters, LSP diagnostics, and tsc). pi-lens itself is responsible for:

- **Hook integration** — registers `tool_result` hooks that fire after every `write`/`edit`/`bash` tool call
- **File resolution** — extracts affected file paths from tool events, including bash command analysis
- **Daemon lifecycle** — starts/stops the code-lens daemon per session
- **Status bar** — publishes per-check status (prettier, linters, LSP, tsc) to the pi UI

The codebase is ~1,310 lines of TypeScript (ESM) across 7 source files with zero build step — pi loads `.ts` files directly at runtime.

We welcome contributions in all forms: bug reports, hook behavior improvements, documentation, and test coverage enhancements.

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

### Local Daemon Development

pi-lens delegates all check execution to the `@harms-haus/code-lens` daemon. If you need to modify check behavior (prettier, linters, LSP, tsc), work in the [code-lens](https://github.com/harms-haus/code-lens) repository. To use a local build of code-lens during pi-lens development:

```bash
# In the code-lens repo
npm run build
npm link

# In the pi-lens repo
npm link @harms-haus/code-lens
```

Changes to pi-lens itself typically involve hook behavior, file resolution, configuration, or daemon communication.

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
│   ├── types.ts                 # Core interfaces: LensConfig, CheckStatus, LensStatusPayload
│   ├── config.ts                # Configuration loading: reads .pi-lens.json, merges with defaults, validates types
│   ├── hook-runner.ts           # Main orchestrator: resolves files from tool results, sends fullCheck to daemon
│   ├── bash-file-detector.ts    # Bash command analyzer: detects file-writing patterns in command strings
│   ├── renderer.ts              # TUI diagnostic renderer: formats check results with colour for the pi terminal UI
│   ├── helpers.ts               # Shared runtime helpers (e.g. type guards)
│   └── __tests__/
│       ├── setup.ts                 # Shared test setup and helpers
│       ├── index.test.ts            # Tests for the extension entry point
│       ├── config.test.ts           # Tests for configuration loading
│       ├── hook-runner.test.ts      # Tests for the hook orchestrator and file resolution
│       ├── bash-file-detector.test.ts # Tests for bash command analysis
│       ├── renderer.test.ts         # Tests for the TUI diagnostic renderer
│       └── helpers.test.ts          # Tests for shared runtime helpers
├── skills/
│   └── code-lens-explorer/
│       └── SKILL.md             # Pi agent skill for codebase exploration
├── docs/
│   ├── architecture.md          # Technical architecture deep-dive
│   ├── configuration.md         # Configuration reference
│   └── adding-checks.md         # Guide for adding new check types
├── package.json                 # Project metadata, scripts, dependencies
├── tsconfig.json                # TypeScript config (ES2022 target, ESNext modules, strict mode)
├── vitest.config.ts             # Vitest configuration
├── README.md                    # User-facing documentation
├── CHANGELOG.md                 # Version history
└── LICENSE                      # MIT License
```

### Module Responsibilities

- **`index.ts`** — Default export function receiving `ExtensionAPI`. Manages session lifecycle: calls `ensureDaemon()` on `session_start` and `stopDaemon()` on `session_shutdown`. Installs the `tool_result` hook that triggers pi-lens checks for `write`/`edit`/`bash` tools. Publishes per-check status bar updates via the pi UI.
- **`types.ts`** — Defines shared interfaces: `LensConfig` (configuration with check toggles, timeouts, glob patterns), `CheckStatus` (status union type: pending/running/clean/issues/error/skipped), and `LensStatusPayload` (status bar payload for all four check types).
- **`config.ts`** — Exports `loadConfig(cwd)` and `DEFAULT_CONFIG`. Reads `.pi-lens.json`, parses JSON, validates types per key (boolean, number, string array), and silently ignores unknown or mistyped keys.
- **`hook-runner.ts`** — The orchestrator. `resolveFilesFromToolResult()` extracts file paths from tool events (direct paths for `write`/`edit`, pattern analysis for `bash`). `runChecks()` sends a `fullCheck` JSON-RPC request to the code-lens daemon via Unix socket and returns a `HookResult` with formatted text, per-check statuses, and duration. Also handles file filtering by include/exclude glob patterns.
- **`bash-file-detector.ts`** — Analyzes bash command strings for file-writing patterns: sed, cat, echo, tee, perl, awk, python -c, dd, mv, cp, and shell redirects. Returns `{ written: string[], read: string[] }`. Best-effort — documented limitations include variable expansion, subshells, and eval.
- **`renderer.ts`** — TUI diagnostic renderer registered via `pi.registerMessageRenderer()`. Exports `renderLensDiagnostics()` which formats per-check status (prettier, linters, LSP, tsc) with colour-coded icons and labels, plus optional expanded detail text. Uses an inline `DiagnosticPanel` class to satisfy the pi TUI component contract. Includes a `LensDiagnosticDetails` interface for typed message payloads and graceful error fallback.
- **`helpers.ts`** — Shared runtime utilities. Exports `isRecord()`, a type guard for plain objects.

All check execution (prettier, linters, LSP diagnostics, tsc) is handled by the `@harms-haus/code-lens` daemon. pi-lens communicates with it via a JSON-RPC protocol over Unix sockets.

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

// Mock the code-lens daemon client
vi.mock("@harms-haus/code-lens/client", () => ({
  sendRequest: vi.fn(),
  ensureDaemon: vi.fn(),
  stopDaemon: vi.fn(),
  getSocketPath: vi.fn(),
}));
```

Tests then import the mocked modules and access typed mock functions via `vi.mocked()`:

```typescript
import * as fs from "node:fs";
const mockedExistsSync = vi.mocked(fs.existsSync);
```

### Test Data

- **Config tests** mock `fs.readFileSync` to simulate config file contents — valid JSON, malformed JSON, missing files, and unknown keys.
- **Hook-runner tests** mock the code-lens daemon `sendRequest` to verify file resolution, glob filtering, daemon communication, and result formatting.
- **Bash-file-detector tests** use inline command strings to verify pattern matching across sed, cat, echo, tee, perl, awk, python, dd, mv, cp, and redirect patterns.
- **Index tests** mock the code-lens client (`ensureDaemon`, `stopDaemon`) and hook-runner to verify session lifecycle and status bar behavior.

### Test Coverage by Module

| Test File | Source Module | Focus |
|-----------|--------------|-------|
| `index.test.ts` | `index.ts` | Session lifecycle, daemon start/stop, hook registration, status bar updates |
| `config.test.ts` | `config.ts` | Config loading, defaults, malformed JSON, unknown keys |
| `hook-runner.test.ts` | `hook-runner.ts` | File resolution, daemon communication, glob filtering, error handling |
| `bash-file-detector.test.ts` | `bash-file-detector.ts` | Command analysis patterns, edge cases, limitations |
| `renderer.test.ts` | `renderer.ts` | All status types (clean/issues/error/skipped/running/pending), expanded/collapsed view, missing details, unknown status fallback |
| `helpers.test.ts` | `helpers.ts` | Type guard behaviour |

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

Check execution lives in the [`@harms-haus/code-lens`](https://github.com/harms-haus/code-lens) daemon. To add a new check type:

1. Add the check runner to the code-lens daemon
2. Add a config toggle to `src/config.ts` and `src/types.ts`
3. Update the daemon request in `src/hook-runner.ts` to pass the new config option
4. Update the status bar in `src/index.ts` if a new status key is needed
5. Add tests in `src/__tests__/`
6. Update documentation

See [docs/adding-checks.md](docs/adding-checks.md) for a step-by-step guide.

### Bug Fixes

Bug fix PRs should include a test case that reproduces the issue and verifies the fix. If a bug was reported without a test, adding one is strongly encouraged.

## License

By contributing to pi-lens, you agree that your contributions will be licensed under the [MIT License](LICENSE).
