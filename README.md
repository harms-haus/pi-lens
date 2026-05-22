# pi-lens

Unified code quality extension for [pi](https://github.com/earendil-works/pi-coding-agent) — auto-runs prettier, linters, LSP diagnostics, and `tsc` on changed files, reporting results inline back to the agent.

## Overview

pi-lens hooks after every `write`, `edit`, and `bash` tool call and automatically runs code quality checks on the affected files — prettier, linters, LSP diagnostics, and TypeScript type checking in a single pass. When used with pi-subagents, pi-lens also monitors subagent file edits in real-time, updating status as changes are detected.

## Features

- **Prettier checking (report-only)** — Detects files needing formatting and reports them (does NOT auto-write)
- **Auto-linting** — Detects and runs the 11 supported linters on changed files
- **LSP diagnostics** — Queries language server diagnostics for 33 supported languages
- **TypeScript checking** — Runs `tsc --noEmit` on changed TS/JS files
- **Bash file detection** — Analyzes bash commands (`sed`, `cat`, `echo`, `tee`, `perl`, `awk`, `mv`, `cp`, etc.) to detect affected files
- **Subagent monitoring** — Detects file changes from subagent (`delegate_to_subagents`) tool calls in real-time and runs checks with a 5-second cooldown to avoid excessive daemon load
- **Unified status bar** — Single `pi-lens` status display combining all check results
- **Rich TUI diagnostic panel** — Color-coded status indicators with ✅⚠✗⊘ icons (opt-in via `piLensRenderer` setting)

## Installation

### Prerequisites

pi-lens requires the `@harms-haus/code-lens` daemon for check execution. The dependency is installed automatically with pi-lens. For standalone CLI use, you can optionally install it globally:

```bash
npm i -g @harms-haus/code-lens   # optional — only needed for standalone CLI use
```

### Install pi-lens

From npm (recommended):

```bash
# Global install (available in all projects)
pi install npm:@harms-haus/pi-lens

# Or project-local install
pi install -l npm:@harms-haus/pi-lens
```

From GitHub:

```bash
pi install git:github.com/harms-haus/pi-lens
```

Or try it temporarily without installing:

```bash
pi -e npm:@harms-haus/pi-lens
```

## Configuration

pi-lens is configured via a `.pi-lens.json` file in your project root. If no config file exists, all checks are enabled with sensible defaults.

### `.pi-lens.json` schema

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

All fields are optional — only include the ones you want to override. See [docs/configuration.md](docs/configuration.md) for the full reference.

### TUI diagnostic renderer

pi-lens can display a rich, color-coded diagnostic panel in the pi TUI after each check run. This is opt-in and disabled by default.

Enable it by adding the `piLensRenderer` setting to your global pi agent settings file (`~/.pi/agent/settings.json`):

```json
{
  "piLensRenderer": true
}
```

| Setting          | File                        | Default | Description                                          |
| ---------------- | --------------------------- | ------- | ---------------------------------------------------- |
| `piLensRenderer` | `~/.pi/agent/settings.json` | `false` | Show a color-coded TUI diagnostic panel after checks |

When enabled:

- A diagnostic panel appears after every `write`/`edit`/`bash` that triggers checks
- The panel shows a header (file count, duration, pass/fail) and per-check status lines with color-coded icons
- Press **Ctrl+E** to expand the panel and see full diagnostic details
- The existing plain-text output is still appended to tool results for the AI agent

### Quick examples

**Disable prettier and tsc, keep linting and LSP:**

```json
{
  "prettier": false,
  "tsc": false
}
```

**Linting only (disable everything else):**

```json
{
  "prettier": false,
  "lsp": false,
  "tsc": false
}
```

## Supported Linters

> **Note:** Linter detection and execution is handled by the `@harms-haus/code-lens` daemon. pi-lens sends files to the daemon and receives formatted results.

pi-lens (via the code-lens daemon) detects and runs linters automatically. 11 linters are supported across 7 languages:

| Linter          | Languages              | Config Files                                            | Detection                                  |
| --------------- | ---------------------- | ------------------------------------------------------- | ------------------------------------------ |
| **ESLint**      | JavaScript, TypeScript | `.eslintrc*`, `eslint.config.*`                         | Config files, `package.json#eslint`        |
| **Biome**       | JavaScript, TypeScript | `biome.json`                                            | Config file, `package.json#@biomejs/biome` |
| **Ruff**        | Python                 | `ruff.toml`, `.ruff.toml`, `pyproject.toml#[tool.ruff]` | Config files, `pyproject.toml` markers     |
| **Flake8**      | Python                 | `.flake8`, `setup.cfg#[flake8]`, `tox.ini#[flake8]`     | Config files, Python project markers       |
| **Pylint**      | Python                 | `.pylintrc`, `pyproject.toml#[tool.pylint]`             | Config files, Python project markers       |
| **Mypy**        | Python                 | `mypy.ini`, `.mypy.ini`, `pyproject.toml#[tool.mypy]`   | Config files, Python project markers       |
| **Clippy**      | Rust                   | `Clippy.toml`, `.clippy.toml`                           | `Cargo.toml` project marker                |
| **staticcheck** | Go                     | _(uses Go toolchain)_                                   | `go.mod` project marker                    |
| **RuboCop**     | Ruby                   | `.rubocop.yml`                                          | `Gemfile` project marker                   |
| **ShellCheck**  | Shell                  | `.shellcheckrc`                                         | Config file (`.shellcheckrc`)              |
| **Stylelint**   | CSS, SCSS, Less        | `.stylelintrc*`, `stylelint.config.*`                   | Config files, `package.json#stylelint`     |

## Supported LSP Servers

> **Note:** LSP server lifecycle, communication, and diagnostics are all managed by the `@harms-haus/code-lens` daemon.

pi-lens (via the code-lens daemon) queries LSP diagnostics for 33 languages:

| Language              | Extensions                          | Server                            | Install                                                |
| --------------------- | ----------------------------------- | --------------------------------- | ------------------------------------------------------ |
| TypeScript/JavaScript | .ts, .tsx, .js, .jsx, .mjs, .cjs    | typescript-language-server        | `npm install -g typescript-language-server typescript` |
| Python                | .py                                 | pylsp                             | `pip install python-lsp-server`                        |
| Rust                  | .rs                                 | rust-analyzer                     | `rustup component add rust-analyzer`                   |
| Go                    | .go                                 | gopls                             | `go install golang.org/x/tools/gopls@latest`           |
| Java                  | .java                               | Eclipse JDT LS                    | Download from GitHub                                   |
| C/C++                 | .c, .cpp, .cc, .cxx, .h, .hpp, .hxx | clangd                            | `apt install clangd`                                   |
| C#                    | .cs                                 | OmniSharp                         | `dotnet tool install -g omnisharp`                     |
| PHP                   | .php                                | intelephense                      | `npm install -g intelephense`                          |
| Ruby                  | .rb                                 | ruby-lsp                          | `gem install ruby-lsp`                                 |
| Lua                   | .lua                                | lua-language-server               | `npm install -g lua-language-server`                   |
| HTML                  | .html, .htm                         | html-languageserver               | `npm install -g vscode-html-languageserver-bin`        |
| CSS/SCSS/LESS         | .css, .scss, .less                  | css-languageserver                | `npm install -g vscode-css-languageserver-bin`         |
| JSON                  | .json, .jsonc                       | json-languageserver               | `npm install -g vscode-json-languageserver-bin`        |
| YAML                  | .yaml, .yml                         | yaml-language-server              | `npm install -g yaml-language-server`                  |
| Markdown              | .md                                 | markdown-language-server          | `npm install -g vscode-markdown-languageserver`        |
| Dart                  | .dart                               | dart language-server              | Install Dart SDK                                       |
| Kotlin                | .kt, .kts                           | kotlin-language-server            | Download from GitHub                                   |
| Swift                 | .swift                              | sourcekit-lsp                     | Included with Swift >= 5.6                             |
| Zig                   | .zig                                | zls                               | Download from GitHub                                   |
| Haskell               | .hs, .lhs                           | haskell-language-server           | `ghcup install hls`                                    |
| OCaml                 | .ml, .mli                           | ocamllsp                          | `opam install ocaml-lsp-server`                        |
| Elixir                | .ex, .exs                           | elixir-ls                         | Download from GitHub                                   |
| Scala                 | .scala, .sbt                        | metals                            | `cs install metals`                                    |
| Terraform/HCL         | .tf, .tfvars, .hcl                  | terraform-ls                      | Download from GitHub                                   |
| Dockerfile            | Dockerfile, .dockerfile             | dockerfile-language-server-nodejs | `npm install -g dockerfile-language-server-nodejs`     |
| SQL                   | .sql                                | sql-language-server               | `npm install -g sql-language-server`                   |
| Vue                   | .vue                                | vue-language-server               | `npm install -g @vue/language-server`                  |
| Svelte                | .svelte                             | svelteserver                      | `npm install -g svelte-language-server`                |
| TOML                  | .toml                               | taplo                             | `npm install -g @taplo/lsp`                            |
| Nix                   | .nix                                | nil                               | `nix profile install nixpkgs#nil`                      |
| LaTeX                 | .tex, .latex                        | texlab                            | `cargo install texlab`                                 |
| R                     | .r, .R                              | languageserver                    | `R -e 'install.packages("languageserver")'`            |
| Bash/Shell            | .sh, .bash                          | bash-language-server              | `npm install -g bash-language-server`                  |

## How It Works

pi-lens is a **thin daemon client** that delegates all check execution to the [`@harms-haus/code-lens`](https://github.com/harms-haus/code-lens) daemon. It registers event hooks for tool results and subagent monitoring. After every `write`, `edit`, or `bash` tool call:

```
tool_result event
  │
  ├─ Is tool write/edit/bash? ── No ──→ skip
  │
  ├─ Is result an error? ── Yes ──→ skip
  │
  ├─ Resolve affected files
  │     ├─ write/edit → extract file path
  │     └─ bash → analyze command string for file-writing patterns
  │
  ├─ Filter files by include/exclude patterns
  │
  └─ Send fullCheck request to code-lens daemon (via Unix socket)
        │
        │  Daemon runs all checks concurrently:
        ├─ Prettier — check formatting (report-only)
        ├─ Linters — run detected linters
        ├─ LSP — query language server diagnostics
        └─ TSC — run tsc --noEmit
        │
        └─ Receive formatted results → append to tool output
```

### Daemon lifecycle

- **Session start**: `ensureDaemon()` starts or connects to the code-lens daemon for the project directory
- **Per check**: `runChecks()` sends a single `fullCheck` JSON-RPC request over a Unix socket. The daemon runs all four check types concurrently and returns formatted results plus per-check statuses
- **Session shutdown**: `stopDaemon()` stops the daemon process

### Subagent monitoring

pi-lens also monitors subagent file edits while a `delegate_to_subagents` tool call is in progress, updating the status bar in real-time:

```
tool_execution_update event
  │
  ├─ Is tool delegate_to_subagents? ── No ──→ skip
  │
  ├─ Has tool activity in windows? ── No ──→ skip
  │
  ├─ 5s cooldown elapsed? ── Yes ──→ run check immediately
  │                             ── No ──→ queue for remaining cooldown
  │
  └─ git diff --name-only HEAD → resolve changed files
        │
        └─ runChecks() → publishStatus() → status bar updates

tool_execution_end event
  └─ Forces a final check (bypasses cooldown)
```

Subagent checks use `git diff --name-only HEAD` to resolve changed files (since tool input doesn't contain direct file paths). A 5-second cooldown prevents excessive daemon load during rapid subagent activity. Pending checks are deferred and run once the cooldown elapses.

### Check execution (handled by the daemon)

All checks are executed by the `@harms-haus/code-lens` daemon, not by pi-lens itself:

1. **Prettier** — Runs `prettier --check` on supported file types. Reports which files need formatting but does NOT modify them.
2. **Linters** — Runs all detected linters relevant to the changed files. Reports errors, warnings, and info messages.
3. **LSP Diagnostics** — Notifies LSP servers about file changes, waits for diagnostics to settle, then reports issues.
4. **TSC** — Runs `tsc --noEmit` on TypeScript/JavaScript files and reports type errors.

### Example output

After editing a TypeScript file with issues:

```
🔍 pi-lens: 1 file(s) (234ms) - ⚠ prettier • ⚠ linters • ✅ lsp • ✅ tsc
  ⚠ prettier: 1 file(s) need formatting
    src/utils.ts
  ⚠ Lint Results: 2 warning(s) in 1 file(s)
 ⚠ src/utils.ts:15:7: Unexpected var, use let or const instead (no-var) [eslint]
```

When all checks pass:

```
🔍 pi-lens: 1 file(s) (89ms) - ✅ prettier • ✅ linters • ✅ lsp • ✅ tsc
```

### Rendered diagnostic panel (TUI)

When the `piLensRenderer` setting is enabled, checks also produce a color-coded panel in the TUI:

**All checks clean:**

```
🔍 pi-lens: 1 file(s) (234ms) - ✅ prettier • ✅ linters • ✅ lsp • ✅ tsc  (green)
```

**Issues found:**

```
🔍 pi-lens: 1 file(s) (1200ms) - ✅ prettier • ⚠ linters • ✅ lsp • ✅ tsc  (yellow)
```

**With errors and skipped checks:**

```
🔍 pi-lens: 2 file(s) (890ms) - ✗ prettier • ⚠ linters • ✅ lsp • ⊘ tsc  (yellow)
```

Press **Ctrl+E** to expand any panel and view the full diagnostic output (lint messages, formatting details, etc.).

## Status Bar

pi-lens publishes a unified status bar payload with an aggregate `CheckStatus` per check category. Each category reports one of: `pending`, `running`, `clean`, `issues`, `error`, or `skipped`.

| Category     | Description                                                                      |
| ------------ | -------------------------------------------------------------------------------- |
| **prettier** | Aggregate formatting check status (`skipped` if prettier unavailable)            |
| **linters**  | Aggregate linter status across all detected linters (`skipped` if none detected) |
| **lsp**      | Aggregate LSP diagnostic status across all language servers                      |
| **tsc**      | Aggregate TypeScript type-check status (`skipped` if tsc unavailable)            |

The status bar updates after session start and after every check run. Identical payloads are deduplicated to avoid redundant UI updates.

## Architecture

pi-lens is a thin client that delegates all check execution to the `@harms-haus/code-lens` daemon. The daemon is a companion package that handles prettier, linters, LSP, and tsc — pi-lens only resolves files, loads config, and communicates with the daemon over a Unix socket.

```
pi-lens/
├── src/
│   ├── index.ts               # Extension entry point — session lifecycle, hook registration, status bar
│   ├── hook-runner.ts         # File resolution, daemon communication, result formatting
│   ├── config.ts              # .pi-lens.json loading and defaults
│   ├── helpers.ts             # Shared runtime helpers (type guards)
│   ├── types.ts               # Shared types (LensConfig, CheckStatus, LensStatusPayload)
│   ├── renderer.ts            # TUI diagnostic panel renderer (color-coded status display)
│   └── bash-file-detector.ts  # Bash command analysis for file-writing patterns
├── skills/
│   └── code-lens-explorer/
│       └── SKILL.md           # Pi agent skill file
├── docs/
│   ├── architecture.md        # Deep-dive architecture reference
│   ├── configuration.md       # Configuration reference
│   └── adding-checks.md       # Guide for adding new check types
├── package.json
├── tsconfig.json
└── README.md
```

> For a detailed architecture deep-dive, see [docs/architecture.md](docs/architecture.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, testing, and PR guidelines.

## License

MIT
