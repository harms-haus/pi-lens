# pi-lens

Unified code quality extension for [pi](https://github.com/earendil-works/pi-coding-agent) — auto-runs prettier, linters, LSP diagnostics, and `tsc` on changed files, reporting results inline back to the agent.

## Overview

pi-lens hooks after every `write`, `edit`, and `bash` tool call and automatically runs code quality checks on the affected files — prettier, linters, LSP diagnostics, and TypeScript type checking in a single pass.





## Features

- **Prettier checking (report-only)** — Detects files needing formatting and reports them (does NOT auto-write)
- **Auto-linting** — Detects and runs the 11 supported linters on changed files
- **LSP diagnostics** — Queries language server diagnostics for 33 supported languages
- **TypeScript checking** — Runs `tsc --noEmit` on changed TS/JS files
- **Bash file detection** — Analyzes bash commands (`sed`, `cat`, `echo`, `tee`, `perl`, `awk`, `mv`, `cp`, etc.) to detect affected files
- **Unified status bar** — Single `pi-lens` status display combining all check results

## Installation

Install from GitHub:

```bash
# Global install (available in all projects)
pi install git:github.com/harms-haus/pi-lens

# Or project-local install
pi install -l git:github.com/harms-haus/pi-lens
```

Or try it temporarily without installing:

```bash
pi -e git:github.com/harms-haus/pi-lens
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

pi-lens detects and runs linters automatically. 11 linters are supported across 7 languages:

| Linter | Languages | Config Files | Detection |
|--------|-----------|-------------|-----------|
| **ESLint** | JavaScript, TypeScript | `.eslintrc*`, `eslint.config.*` | Config files, `package.json#eslint` |
| **Biome** | JavaScript, TypeScript | `biome.json` | Config file, `package.json#@biomejs/biome` |
| **Ruff** | Python | `ruff.toml`, `.ruff.toml`, `pyproject.toml#[tool.ruff]` | Config files, `pyproject.toml` markers |
| **Flake8** | Python | `.flake8`, `setup.cfg#[flake8]`, `tox.ini#[flake8]` | Config files, Python project markers |
| **Pylint** | Python | `.pylintrc`, `pyproject.toml#[tool.pylint]` | Config files, Python project markers |
| **Mypy** | Python | `mypy.ini`, `.mypy.ini`, `pyproject.toml#[tool.mypy]` | Config files, Python project markers |
| **Clippy** | Rust | `Clippy.toml`, `.clippy.toml` | `Cargo.toml` project marker |
| **staticcheck** | Go | *(uses Go toolchain)* | `go.mod` project marker |
| **RuboCop** | Ruby | `.rubocop.yml` | `Gemfile` project marker |
| **ShellCheck** | Shell | `.shellcheckrc` | Config file (`.shellcheckrc`) |
| **Stylelint** | CSS, SCSS, Less | `.stylelintrc*`, `stylelint.config.*` | Config files, `package.json#stylelint` |

## Supported LSP Servers

pi-lens queries LSP diagnostics for 33 languages:

| Language | Extensions | Server | Install |
|----------|-----------|--------|---------|
| TypeScript/JavaScript | .ts, .tsx, .js, .jsx, .mjs, .cjs | typescript-language-server | `npm install -g typescript-language-server typescript` |
| Python | .py | pylsp | `pip install python-lsp-server` |
| Rust | .rs | rust-analyzer | `rustup component add rust-analyzer` |
| Go | .go | gopls | `go install golang.org/x/tools/gopls@latest` |
| Java | .java | Eclipse JDT LS | Download from GitHub |
| C/C++ | .c, .cpp, .cc, .cxx, .h, .hpp, .hxx | clangd | `apt install clangd` |
| C# | .cs | OmniSharp | `dotnet tool install -g omnisharp` |
| PHP | .php | intelephense | `npm install -g intelephense` |
| Ruby | .rb | ruby-lsp | `gem install ruby-lsp` |
| Lua | .lua | lua-language-server | `npm install -g lua-language-server` |
| HTML | .html, .htm | html-languageserver | `npm install -g vscode-html-languageserver-bin` |
| CSS/SCSS/LESS | .css, .scss, .less | css-languageserver | `npm install -g vscode-css-languageserver-bin` |
| JSON | .json, .jsonc | json-languageserver | `npm install -g vscode-json-languageserver-bin` |
| YAML | .yaml, .yml | yaml-language-server | `npm install -g yaml-language-server` |
| Markdown | .md | markdown-language-server | `npm install -g vscode-markdown-languageserver` |
| Dart | .dart | dart language-server | Install Dart SDK |
| Kotlin | .kt, .kts | kotlin-language-server | Download from GitHub |
| Swift | .swift | sourcekit-lsp | Included with Swift >= 5.6 |
| Zig | .zig | zls | Download from GitHub |
| Haskell | .hs, .lhs | haskell-language-server | `ghcup install hls` |
| OCaml | .ml, .mli | ocamllsp | `opam install ocaml-lsp-server` |
| Elixir | .ex, .exs | elixir-ls | Download from GitHub |
| Scala | .scala, .sbt | metals | `cs install metals` |
| Terraform/HCL | .tf, .tfvars, .hcl | terraform-ls | Download from GitHub |
| Dockerfile | Dockerfile, .dockerfile | dockerfile-language-server-nodejs | `npm install -g dockerfile-language-server-nodejs` |
| SQL | .sql | sql-language-server | `npm install -g sql-language-server` |
| Vue | .vue | vue-language-server | `npm install -g @vue/language-server` |
| Svelte | .svelte | svelteserver | `npm install -g svelte-language-server` |
| TOML | .toml | taplo | `npm install -g @taplo/lsp` |
| Nix | .nix | nil | `nix profile install nixpkgs#nil` |
| LaTeX | .tex, .latex | texlab | `cargo install texlab` |
| R | .r, .R | languageserver | `R -e 'install.packages("languageserver")'` |
| Bash/Shell | .sh, .bash | bash-language-server | `npm install -g bash-language-server` |

## How It Works

pi-lens registers a single `tool_result` event hook. After every `write`, `edit`, or `bash` tool call:

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
  └─ Run checks concurrently (Promise.all):
        ├─ Prettier — check formatting (report-only)
        ├─ Linters — run detected linters
        ├─ LSP — query language server diagnostics
        └─ TSC — run tsc --noEmit
        │
        └─ Append results to tool output
```

### Check execution

Checks run **concurrently** via `Promise.all` — since prettier is report-only and doesn't write, all four checks are independent:

1. **Prettier** — Runs `prettier --check` on supported file types. Reports which files need formatting but does NOT modify them.
2. **Linters** — Runs all detected linters relevant to the changed files. Reports errors, warnings, and info messages.
3. **LSP Diagnostics** — Notifies LSP servers about file changes, waits for diagnostics to settle, then reports issues.
4. **TSC** — Runs `tsc --noEmit` on TypeScript/JavaScript files and reports type errors.

### Example output

After editing a TypeScript file with issues:

```
🔍 pi-lens: 1 file(s) checked (234ms)
  ⚠ prettier: 1 file(s) need formatting
    src/utils.ts
  ⚠ Lint Results: 2 warning(s) in 1 file(s)
 ⚠ src/utils.ts:15:7: Unexpected var, use let or const instead (no-var) [eslint]
  ✅ lsp: 0 diagnostics
  ✅ tsc: 0 errors
```

When all checks pass:

```
🔍 pi-lens: 1 file(s) checked — all clean (89ms)
```

## Status Bar

pi-lens publishes a unified status bar payload with an aggregate `CheckStatus` per check category. Each category reports one of: `pending`, `running`, `clean`, `issues`, `error`, or `skipped`.

| Category  | Description |
|-----------|-------------|
| **prettier** | Aggregate formatting check status (`skipped` if prettier unavailable) |
| **linters**  | Aggregate linter status across all detected linters (`skipped` if none detected) |
| **lsp**      | Aggregate LSP diagnostic status across all language servers |
| **tsc**      | Aggregate TypeScript type-check status (`skipped` if tsc unavailable) |

The status bar updates after session start and after every check run. Identical payloads are deduplicated to avoid redundant UI updates.

## Architecture

```
pi-lens/
├── src/
│   ├── index.ts               # Extension entry point — session lifecycle, hook registration, status
│   ├── types.ts               # All shared types
│   ├── config.ts              # .pi-lens.json loading and defaults
│   ├── hook-runner.ts         # Main orchestrator — file resolution, check execution, formatting
│   ├── bash-file-detector.ts  # Bash command analysis for file-writing patterns
│   ├── prettier-runner.ts     # Prettier availability detection and --check execution
│   ├── tsc-runner.ts          # TypeScript compiler detection and execution
│   ├── linter-registry.ts     # Linter detection pipeline
│   ├── linter-runner.ts       # Linter execution and output formatting
│   ├── definitions.ts         # 11 linter definitions
│   ├── parsers.ts             # 11 output parsers
│   ├── output-formatter.ts    # Issue formatting and summarization
│   ├── lsp-manager.ts         # LSP server lifecycle and diagnostics cache
│   ├── lsp-client.ts          # JSON-RPC LSP client transport
│   ├── lsp-client-methods.ts  # LSP protocol methods (init, didOpen, diagnostics)
│   ├── lsp-protocol.ts        # LSP/JSON-RPC type definitions
│   ├── language-config.ts     # 33 language server configurations
│   └── spawn-utils.ts         # Child process spawning utilities
├── skills/
│   └── lens-hooks/
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
