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

## Tools

Code-lens provides these daemon-backed tools. Each sends a request to a warm LSP server and returns structured results.

| Tool | What it does |
|------|-------------|
| `hover` | Shows type info and docs for a symbol at a position |
| `find-definition` | Jumps to where a symbol is defined |
| `find-references` | Finds all usages of a symbol across the workspace |
| `find-implementations` | Finds concrete implementations of an interface/abstract class |
| `find-type-definition` | Jumps to the *type* definition of an expression (e.g., the class behind a variable) |
| `find-type-hierarchy` | Shows inheritance chain (parents and/or children) for a type |
| `find-symbols` | Fuzzy-searches for symbols by name across the workspace |
| `find-document-symbols` | Lists all symbols (classes, functions, variables) in a single file |
| `find-calls` | Shows callers and callees for a function |
| `rename-symbol` | Renames a symbol across the entire workspace |
| `diagnostics` | Gets LSP diagnostics (errors, warnings) for a file or the whole workspace |

The daemon auto-starts on first use and keeps LSP servers warm across calls. No manual lifecycle management needed when using the CLI.
