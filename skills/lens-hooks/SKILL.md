---
name: lens-hooks
description: Auto-runs code quality checks after file changes — prettier, linters, LSP diagnostics, and tsc.
---

# Lens Hooks

## Overview

pi-lens is a unified code quality extension that automatically runs checks after every `write`, `edit`, or `bash` tool call. It combines four check types into a single post-tool hook:

1. **Prettier** — report-only format checking (does NOT write files)
2. **Linters** — auto-detected project linters (ESLint, Biome, Ruff, etc.)
3. **LSP Diagnostics** — language server diagnostics with configurable delay
4. **TSC** — TypeScript type checking via `tsc --noEmit`

Results are appended to the tool output automatically. You do not need to call pi-lens explicitly.

## Automatic Behavior

After every `write`, `edit`, or `bash` tool call, pi-lens:

1. Detects changed files from the tool result
   - For `write`/`edit`: extracts the file path from input
   - For `bash`: analyzes the command string for file-writing patterns (sed, cat, echo, tee, etc.)
2. Runs applicable checks in order: prettier → linters → LSP → tsc
3. Appends formatted results to the tool output
4. Updates the status bar with check results

## Check Results

Results appear inline after the tool output:

```
🔍 pi-lens: 2 file(s) checked (340ms)
  ⚠ prettier: 1 file(s) need formatting
    src/index.ts
  ✅ linters: 0 issues
  ⚠ lsp: 3 diagnostic(s) (2 error(s), 1 warning(s))
    ✗ src/index.ts:15:3: Type 'string' is not assignable to type 'number'
    ⚠ src/types.ts:8:1: 'x' is declared but never used
  ✅ tsc: 0 errors
```

When all checks pass and `alwaysReport` is enabled (default):
```
🔍 pi-lens: 1 file(s) checked — all clean (120ms)
```

## Supported Linters

| Linter | Languages | Detection |
|--------|-----------|-----------|
| ESLint | JS, TS | .eslintrc*, eslint.config.*, package.json#eslint |
| Biome | JS, TS | biome.json |
| Ruff | Python | ruff.toml, pyproject.toml#[tool.ruff] |
| Flake8 | Python | .flake8, setup.cfg#[flake8] |
| Pylint | Python | .pylintrc |
| Mypy | Python | mypy.ini, pyproject.toml#[tool.mypy] |
| Clippy | Rust | Cargo.toml |
| staticcheck | Go | go.mod |
| RuboCop | Ruby | .rubocop.yml |
| ShellCheck | Shell | .shellcheckrc, .sh/.bash files |
| Stylelint | CSS, SCSS | .stylelintrc*, stylelint.config.* |

## Supported LSP Languages

pi-lens bundles LSP server configurations for 33 languages including TypeScript, Python, Rust, Go, C/C++, Java, Ruby, and more. Servers are auto-started when a file of the corresponding language is opened and auto-stopped after an idle timeout.

## Configuration

Create a `.pi-lens.json` in your project root:

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

All fields are optional — defaults are used for missing keys.

## Agent Guidelines

- pi-lens is the sole code quality extension — no other extensions needed
- **You do not need to manually run checks** — pi-lens runs automatically after edits
- **React to reported issues** — if pi-lens reports formatting, lint, or type errors, fix them in subsequent edits
- **Prettier is report-only** — pi-lens tells you what needs formatting but does NOT apply fixes; run `npx prettier --write <file>` if needed
- **Bash detection is best-effort** — for complex bash commands, pi-lens may not detect all affected files; consider running manual checks if unsure
- **Check timeouts** — individual checks have timeouts (prettier: 15s, linters: 15s, tsc: 30s); if a check times out, it appears as an error in the output
