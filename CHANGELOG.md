# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
