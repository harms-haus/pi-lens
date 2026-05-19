---
name: code-lens-explorer
description: How to use @harms-haus/code-lens to explore and query a codebase via LSP.
---

# Code Lens Explorer

## Check if installed

```bash
code-lens --version
```

If not found, install globally:

```bash
npm i -g @harms-haus/code-lens
```

## Commands

All position-based commands use `--file`, `--line`, `--col` (1-indexed). The daemon auto-starts on first use.

### `hover` — Type info and docs for a symbol
```bash
code-lens hover --file <path> --line <n> --col <n>
```

### `find-definition` — Where a symbol is defined
```bash
code-lens find-definition --file <path> --line <n> --col <n>
```

### `find-references` — All usages of a symbol
```bash
code-lens find-references --file <path> --line <n> --col <n>
```

### `find-implementations` — Concrete implementations of an interface
```bash
code-lens find-implementations --file <path> --line <n> --col <n>
```

### `find-type-definition` — Type definition of an expression
```bash
code-lens find-type-definition --file <path> --line <n> --col <n>
```

### `find-type-hierarchy` — Inheritance chain for a type
```bash
code-lens find-type-hierarchy --file <path> --line <n> --col <n>
                                              [--direction supertypes|subtypes|both]
                                              [--depth <n>]
```
- `--direction` (optional, default: `both`)
- `--depth` (optional, default: `2`)

### `find-symbols` — Fuzzy search symbols across the workspace
```bash
code-lens find-symbols --query <string> [--kind <kind>]
```
- `--kind` (optional) — filter: `class`, `function`, `interface`, `enum`, etc.

### `find-document-symbols` — List all symbols in a file
```bash
code-lens find-document-symbols --file <path>
```

### `find-calls` — Callers and callees for a function
```bash
code-lens find-calls --file <path> --line <n> --col <n>
```

### `rename-symbol` — Rename a symbol across the workspace
```bash
code-lens rename-symbol --file <path> --line <n> --col <n> --new-name <string>
```

### `diagnostics` — LSP diagnostics for files or workspace
```bash
code-lens diagnostics --file <path>
code-lens diagnostics --files <paths>  # comma-separated
code-lens diagnostics --workspace      # entire workspace
                       [--refresh]     # force refresh
```
