# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-05-19

### Added

- Dependency on `@harms-haus/code-lens` for daemon-based code checking

### Changed

- **BREAKING**: Migrated from embedded LSP/linting code to thin daemon client architecture
- All code checks (prettier, linters, LSP diagnostics, tsc) now execute via the code-lens daemon
- Daemon is started on `session_start` and stopped on `session_shutdown`
- Hook runner sends a single `fullCheck` request to the daemon instead of running checks locally

### Removed

- **BREAKING**: Removed all embedded runner modules (`prettier-runner`, `tsc-runner`, `linter-runner`, `linter-registry`, `parsers`, `definitions`, `output-formatter`, `spawn-utils`)
- **BREAKING**: Removed all embedded LSP modules (`lsp-manager`, `lsp-client`, `lsp-client-methods`, `lsp-protocol`, `language-config`)
- Removed `vscode-languageserver-types` dependency
- Removed 17 source files and 12 test files

## [1.0.0] — 2025-05-18

### Added

- **Unified code quality hook** — automatically runs prettier, linters, LSP diagnostics, and tsc after `write`, `edit`, and `bash` tool calls
- **Prettier checking** — report-only mode; detects files needing formatting without modifying them
- **11 linter support** — ESLint, Biome, Ruff, Flake8, Pylint, Mypy, Clippy, staticcheck, RuboCop, ShellCheck, Stylelint
- **LSP diagnostics** — auto-starts language servers for 30+ languages with idle timeout management
- **TypeScript checking** — runs `tsc --noEmit` on changed TS/JS files
- **Bash file detection** — best-effort detection of files modified by bash commands (sed, echo, tee, etc.)
- **Status bar** — unified pi-lens status display with per-check indicators
- **Configuration** — `.pi-lens.json` with full customization of check enablement, timeouts, and patterns
- **Comprehensive test suite** — unit tests with Vitest for all modules
