import { describe, it, expect } from "vitest";
import {
  parseEslintOutput,
  parseBiomeOutput,
  parseRuffOutput,
  parseFlake8Output,
  parsePylintOutput,
  parseMypyOutput,
  parseClippyOutput,
  parseStaticcheckOutput,
  parseRubocopOutput,
  parseShellcheckOutput,
  parseStylelintOutput,
} from "../parsers.js";

describe("parseEslintOutput", () => {
  it('returns empty array for "[]"', () => {
    const result = parseEslintOutput("[]", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses valid ESLint JSON with 2 files and messages", () => {
    const input = JSON.stringify([
      {
        filePath: "/path/to/file1.js",
        messages: [
          {
            line: 10,
            column: 5,
            endLine: 10,
            endColumn: 15,
            severity: 2,
            message: "Expected '==='",
            ruleId: "eqeqeq",
          },
          {
            line: 20,
            column: 8,
            severity: 1,
            message: "Unused variable 'x'",
            ruleId: "no-unused-vars",
          },
        ],
      },
      {
        filePath: "/path/to/file2.js",
        messages: [
          {
            line: 15,
            column: 1,
            severity: 2,
            message: "Unexpected console statement",
            ruleId: "no-console",
          },
        ],
      },
    ]);
    const result = parseEslintOutput(input, "/test/cwd");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      file: "/path/to/file1.js",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 15,
      severity: "error",
      message: "Expected '==='",
      code: "eqeqeq",
      source: "eslint",
    });
    expect(result[1]).toEqual({
      file: "/path/to/file1.js",
      line: 20,
      column: 8,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Unused variable 'x'",
      code: "no-unused-vars",
      source: "eslint",
    });
    expect(result[2]).toEqual({
      file: "/path/to/file2.js",
      line: 15,
      column: 1,
      endLine: undefined,
      endColumn: undefined,
      severity: "error",
      message: "Unexpected console statement",
      code: "no-console",
      source: "eslint",
    });
  });

  it('returns empty array for invalid JSON "not json"', () => {
    const result = parseEslintOutput("not json", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("defaults to line 1 and column 1 for null values", () => {
    const input = JSON.stringify([
      {
        filePath: "/path/to/file.js",
        messages: [
          {
            line: null,
            column: null,
            severity: 2,
            message: "Test error",
            ruleId: "test-rule",
          },
        ],
      },
    ]);
    const result = parseEslintOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(1);
    expect(result[0].column).toBe(1);
  });

  it("returns empty array for non-array JSON", () => {
    const result = parseEslintOutput("{}", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("defaults file to empty string when filePath missing", () => {
    const input = JSON.stringify([
      {
        messages: [
          {
            line: 5,
            column: 3,
            severity: 1,
            message: "msg",
          },
        ],
      },
    ]);
    const result = parseEslintOutput(input, "/test/cwd");
    expect(result[0].file).toBe("");
  });

  it("defaults endLine/endColumn to undefined when not provided", () => {
    const input = JSON.stringify([
      {
        filePath: "/path/to/file.js",
        messages: [
          {
            line: 5,
            column: 3,
            severity: 1,
            message: "msg",
          },
        ],
      },
    ]);
    const result = parseEslintOutput(input, "/test/cwd");
    expect(result[0].endLine).toBeUndefined();
    expect(result[0].endColumn).toBeUndefined();
  });

  it("defaults message to empty string when not provided", () => {
    const input = JSON.stringify([
      {
        filePath: "/path/to/file.js",
        messages: [
          {
            line: 5,
            column: 3,
            severity: 1,
          },
        ],
      },
    ]);
    const result = parseEslintOutput(input, "/test/cwd");
    expect(result[0].message).toBe("");
  });

  it("sets code to undefined for null ruleId", () => {
    const input = JSON.stringify([
      {
        filePath: "/path/to/file.js",
        messages: [
          {
            line: 10,
            column: 5,
            severity: 1,
            message: "Warning message",
            ruleId: null,
          },
        ],
      },
    ]);
    const result = parseEslintOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].code).toBeUndefined();
  });
});

describe("parseBiomeOutput", () => {
  it('returns empty array for {"diagnostics": []}', () => {
    const result = parseBiomeOutput('{"diagnostics": []}', "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses valid biome JSON with 2 diagnostics", () => {
    const input = JSON.stringify({
      diagnostics: [
        {
          location: {
            path: "src/file1.ts",
            start: { line: 10, column: 5 },
            end: { line: 10, column: 15 },
          },
          severity: "error",
          message: "Type error",
          category: "lint/suspicious/noExplicitAny",
        },
        {
          location: {
            path: "src/file2.ts",
            start: { line: 20, column: 1 },
            end: { line: 20, column: 25 },
          },
          severity: "warning",
          message: "Unused import",
          category: "lint/complexity/noUnusedImports",
        },
      ],
    });
    const result = parseBiomeOutput(input, "/test/cwd");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "/test/cwd/src/file1.ts",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 15,
      severity: "error",
      message: "Type error",
      code: "suspicious/noExplicitAny",
      source: "biome",
    });
    expect(result[1]).toEqual({
      file: "/test/cwd/src/file2.ts",
      line: 20,
      column: 1,
      endLine: 20,
      endColumn: 25,
      severity: "warning",
      message: "Unused import",
      code: "complexity/noUnusedImports",
      source: "biome",
    });
  });

  it("returns empty array for invalid JSON", () => {
    const result = parseBiomeOutput("not json", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("resolves relative paths with cwd", () => {
    const input = JSON.stringify({
      diagnostics: [
        {
          location: {
            path: "relative/path/file.ts",
            start: { line: 5, column: 3 },
          },
          severity: "error",
          message: "Error",
        },
      ],
    });
    const result = parseBiomeOutput(input, "/my/project");
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("/my/project/relative/path/file.ts");
  });

  it("uses absolute paths as-is", () => {
    const input = JSON.stringify({
      diagnostics: [
        {
          location: {
            path: "/absolute/path/file.ts",
            start: { line: 5, column: 3 },
          },
          severity: "error",
          message: "Error",
        },
      ],
    });
    const result = parseBiomeOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("/absolute/path/file.ts");
  });
});

describe("parseRuffOutput", () => {
  it('returns empty array for "[]"', () => {
    const result = parseRuffOutput("[]", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses array with 2 results", () => {
    const input = JSON.stringify([
      {
        filename: "/path/to/file1.py",
        location: { row: 10, column: 5 },
        end_location: { row: 10, column: 15 },
        severity: "error",
        message: "Syntax error",
        code: "E999",
      },
      {
        filename: "/path/to/file2.py",
        location: { row: 20, column: 8 },
        severity: "warning",
        message: "Line too long",
        code: "E501",
      },
    ]);
    const result = parseRuffOutput(input, "/test/cwd");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "/path/to/file1.py",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 15,
      severity: "error",
      message: "Syntax error",
      code: "E999",
      source: "ruff",
    });
    expect(result[1]).toEqual({
      file: "/path/to/file2.py",
      line: 20,
      column: 8,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Line too long",
      code: "E501",
      source: "ruff",
    });
  });

  it("returns empty array for invalid JSON", () => {
    const result = parseRuffOutput("not json", "/test/cwd");
    expect(result).toEqual([]);
  });
});

describe("parseFlake8Output", () => {
  it("returns empty array for empty string", () => {
    const result = parseFlake8Output("", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses tab-separated line with E-code as error", () => {
    const input = "src/test.py\t10\t5\tE501\tline too long";
    const result = parseFlake8Output(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "src/test.py",
      line: 10,
      column: 5,
      severity: "error",
      message: "line too long",
      code: "E501",
      source: "flake8",
    });
  });

  it("parses W-prefixed code as warning", () => {
    const input = "src/test.py\t15\t8\tW291\ttrailing whitespace";
    const result = parseFlake8Output(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
    expect(result[0].code).toBe("W291");
  });

  it("skips lines with fewer than 5 tab parts", () => {
    const input = "src/test.py\t10\t5\tE501";
    const result = parseFlake8Output(input, "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses F-prefixed code as error", () => {
    const input = "src/test.py\t5\t1\tF821\tundefined name 'x'";
    const result = parseFlake8Output(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("error");
    expect(result[0].code).toBe("F821");
  });
});

describe("parsePylintOutput", () => {
  it('returns empty array for "[]"', () => {
    const result = parsePylintOutput("[]", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses array with results, column +1 offset", () => {
    const input = JSON.stringify([
      {
        path: "/path/to/file.py",
        line: 10,
        column: 5,
        endLine: 10,
        endColumn: 15,
        type: "error",
        message: "Syntax error",
        symbol: "syntax-error",
        "message-id": "E0001",
      },
    ]);
    const result = parsePylintOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].column).toBe(6);
    expect(result[0].endColumn).toBe(16);
  });

  it('type: "fatal" -> error, type: "refactor" -> info', () => {
    const input = JSON.stringify([
      {
        path: "/path/to/file1.py",
        line: 10,
        column: 0,
        type: "fatal",
        message: "Fatal error",
        symbol: "fatal-error",
      },
      {
        path: "/path/to/file2.py",
        line: 20,
        column: 0,
        type: "refactor",
        message: "Refactor this",
        symbol: "refactor-suggestion",
      },
    ]);
    const result = parsePylintOutput(input, "/test/cwd");
    expect(result).toHaveLength(2);
    expect(result[0].severity).toBe("error");
    expect(result[1].severity).toBe("info");
  });

  it("returns empty array for invalid JSON", () => {
    const result = parsePylintOutput("not json", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("uses symbol as code, falls back to message-id", () => {
    const input = JSON.stringify([
      {
        path: "/path/to/file.py",
        line: 10,
        column: 5,
        type: "warning",
        message: "Test warning",
        symbol: "test-symbol",
      },
    ]);
    const result = parsePylintOutput(input, "/test/cwd");
    expect(result[0].code).toBe("test-symbol");
  });
});

describe("parseMypyOutput", () => {
  it("returns empty array for empty string", () => {
    const result = parseMypyOutput("", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses two NDJSON entries", () => {
    const input =
      JSON.stringify({
        file: "/path/to/file1.py",
        line: 10,
        column: 5,
        end_line: 10,
        end_column: 15,
        severity: "error",
        message: "Type error",
        code: "arg-type",
      }) +
      "\n" +
      JSON.stringify({
        file: "/path/to/file2.py",
        line: 20,
        column: 8,
        severity: "warning",
        message: "Missing type annotation",
        code: "no-any-return",
      });
    const result = parseMypyOutput(input, "/test/cwd");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "/path/to/file1.py",
      line: 10,
      column: 6,
      endLine: 10,
      endColumn: 16,
      severity: "error",
      message: "Type error",
      code: "arg-type",
      source: "mypy",
    });
    expect(result[1]).toEqual({
      file: "/path/to/file2.py",
      line: 20,
      column: 9,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Missing type annotation",
      code: "no-any-return",
      source: "mypy",
    });
  });

  it("skips non-JSON line between entries", () => {
    const input =
      JSON.stringify({
        file: "/path/to/file.py",
        line: 10,
        column: 5,
        severity: "error",
        message: "Type error",
        code: "arg-type",
      }) +
      "\nnot a json line\n" +
      JSON.stringify({
        file: "/path/to/other.py",
        line: 20,
        column: 8,
        severity: "warning",
        message: "Another warning",
        code: "no-any-return",
      });
    const result = parseMypyOutput(input, "/test/cwd");
    expect(result).toHaveLength(2);
    expect(result[0].message).toBe("Type error");
    expect(result[1].message).toBe("Another warning");
  });

  it("skips entry without file or message", () => {
    const input =
      JSON.stringify({
        line: 10,
        column: 5,
        severity: "error",
        code: "arg-type",
      }) +
      "\n" +
      JSON.stringify({
        file: "/path/to/file.py",
        severity: "warning",
        code: "no-any-return",
      }) +
      "\n" +
      JSON.stringify({
        file: "/path/to/valid.py",
        line: 5,
        column: 1,
        severity: "error",
        message: "Valid error",
        code: "test-code",
      });
    const result = parseMypyOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("Valid error");
  });

  it("applies column +1 offset", () => {
    const input = JSON.stringify({
      file: "/path/to/file.py",
      line: 10,
      column: 0,
      severity: "error",
      message: "Test",
      code: "test-code",
    });
    const result = parseMypyOutput(input, "/test/cwd");
    expect(result[0].column).toBe(1);
  });
});

describe("parseClippyOutput", () => {
  it("returns empty array for empty string", () => {
    const result = parseClippyOutput("", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses entry with compiler-message and spans", () => {
    const input = JSON.stringify({
      reason: "compiler-message",
      message: {
        spans: [
          {
            file_name: "src/main.rs",
            line_start: 10,
            column_start: 5,
            line_end: 10,
            column_end: 15,
          },
        ],
        level: "error",
        message: "This is a clippy error",
        code: { code: "clippy::all" },
      },
    });
    const result = parseClippyOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "/test/cwd/src/main.rs",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 15,
      severity: "error",
      message: "This is a clippy error",
      code: "clippy::all",
      source: "clippy",
    });
  });

  it("parses entry without spans but with message", () => {
    const input = JSON.stringify({
      reason: "compiler-message",
      message: {
        level: "warning",
        message: "Module-level warning",
        code: { code: "unused_imports" },
      },
    });
    const result = parseClippyOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "",
      line: 1,
      column: 1,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Module-level warning",
      code: "unused_imports",
      source: "clippy",
    });
  });

  it("skips entry with reason 'other'", () => {
    const input = JSON.stringify({
      reason: "other",
      message: {
        level: "error",
        message: "This should be skipped",
      },
    });
    const result = parseClippyOutput(input, "/test/cwd");
    expect(result).toEqual([]);
  });

  it("resolves paths relative to cwd", () => {
    const input = JSON.stringify({
      reason: "compiler-message",
      message: {
        spans: [
          {
            file_name: "src/lib.rs",
            line_start: 5,
            column_start: 1,
          },
        ],
        level: "warning",
        message: "Test warning",
        code: { code: "test_code" },
      },
    });
    const result = parseClippyOutput(input, "/my/project");
    expect(result[0].file).toBe("/my/project/src/lib.rs");
  });
});

describe("parseStaticcheckOutput", () => {
  it("returns empty array for empty string", () => {
    const result = parseStaticcheckOutput("", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses JSON line with resolved path", () => {
    const input = JSON.stringify({
      file: "src/main.go",
      line: 10,
      column: 5,
      severity: "error",
      message: "undefined variable",
      code: "SA4000",
    });
    const result = parseStaticcheckOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "/test/cwd/src/main.go",
      line: 10,
      column: 5,
      severity: "error",
      message: "undefined variable",
      code: "SA4000",
      source: "staticcheck",
    });
  });

  it("parses text format 'file.go:10:5: undefined: foo (SA4000)'", () => {
    const input = "src/main.go:10:5: undefined: foo (SA4000)";
    const result = parseStaticcheckOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: "/test/cwd/src/main.go",
      line: 10,
      column: 5,
      severity: "warning",
      message: "undefined: foo",
      code: "SA4000",
      source: "staticcheck",
    });
  });

  it("resolves path in text format", () => {
    const input = "src/file.go:20:8: some message (SC1000)";
    const result = parseStaticcheckOutput(input, "/my/project");
    expect(result[0].file).toBe("/my/project/src/file.go");
  });

  it("handles text format without code", () => {
    const input = "src/file.go:15:3: some warning message";
    const result = parseStaticcheckOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].code).toBeUndefined();
    expect(result[0].message).toBe("some warning message");
  });
});

describe("parseRubocopOutput", () => {
  it('returns empty array for {"files": []}', () => {
    const result = parseRubocopOutput('{"files": []}', "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses files with 2 offenses", () => {
    const input = JSON.stringify({
      files: [
        {
          path: "/path/to/file1.rb",
          offenses: [
            {
              location: {
                line: 10,
                column: 5,
                last_line: 10,
                last_column: 15,
              },
              severity: "error",
              message: "Useless assignment",
              cop_name: "Lint/UselessAssignment",
            },
            {
              location: {
                line: 20,
                column: 8,
              },
              severity: "warning",
              message: "Line too long",
              cop_name: "Metrics/LineLength",
            },
          ],
        },
        {
          path: "/path/to/file2.rb",
          offenses: [
            {
              location: {
                line: 5,
                column: 1,
              },
              severity: "convention",
              message: "Missing frozen string literal",
              cop_name: "Style/FrozenStringLiteralComment",
            },
          ],
        },
      ],
    });
    const result = parseRubocopOutput(input, "/test/cwd");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      file: "/path/to/file1.rb",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 15,
      severity: "error",
      message: "Useless assignment",
      code: "Lint/UselessAssignment",
      source: "rubocop",
    });
    expect(result[1]).toEqual({
      file: "/path/to/file1.rb",
      line: 20,
      column: 8,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Line too long",
      code: "Metrics/LineLength",
      source: "rubocop",
    });
    expect(result[2]).toEqual({
      file: "/path/to/file2.rb",
      line: 5,
      column: 1,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Missing frozen string literal",
      code: "Style/FrozenStringLiteralComment",
      source: "rubocop",
    });
  });

  it("returns empty array for invalid JSON", () => {
    const result = parseRubocopOutput("not json", "/test/cwd");
    expect(result).toEqual([]);
  });

  it('severity: "fatal" -> error', () => {
    const input = JSON.stringify({
      files: [
        {
          path: "/path/to/file.rb",
          offenses: [
            {
              location: { line: 10, column: 1 },
              severity: "fatal",
              message: "Fatal error",
              cop_name: "Fatal/Error",
            },
          ],
        },
      ],
    });
    const result = parseRubocopOutput(input, "/test/cwd");
    expect(result[0].severity).toBe("error");
  });
});

describe("parseShellcheckOutput", () => {
  it('returns empty array for "[]"', () => {
    const result = parseShellcheckOutput("[]", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses array with 2 results, code prefixed with SC", () => {
    const input = JSON.stringify([
      {
        file: "/path/to/script.sh",
        line: 10,
        column: 5,
        endLine: 10,
        endColumn: 15,
        level: "error",
        message: "Double quote to prevent globbing",
        code: 2086,
      },
      {
        file: "/path/to/other.sh",
        line: 20,
        column: 8,
        level: "warning",
        message: "Quote this to prevent word splitting",
        code: 2046,
      },
    ]);
    const result = parseShellcheckOutput(input, "/test/cwd");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      file: "/path/to/script.sh",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 15,
      severity: "error",
      message: "Double quote to prevent globbing",
      code: "SC2086",
      source: "shellcheck",
    });
    expect(result[1]).toEqual({
      file: "/path/to/other.sh",
      line: 20,
      column: 8,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Quote this to prevent word splitting",
      code: "SC2046",
      source: "shellcheck",
    });
  });

  it('level: "style" -> severity: "info"', () => {
    const input = JSON.stringify([
      {
        file: "/path/to/script.sh",
        line: 15,
        column: 1,
        level: "style",
        message: "Style suggestion",
        code: 1001,
      },
    ]);
    const result = parseShellcheckOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("info");
  });

  it("returns empty array for invalid JSON", () => {
    const result = parseShellcheckOutput("not json", "/test/cwd");
    expect(result).toEqual([]);
  });
});

describe("parseStylelintOutput", () => {
  it('returns empty array for "[]"', () => {
    const result = parseStylelintOutput("[]", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("parses array with file results and warnings", () => {
    const input = JSON.stringify([
      {
        source: "/path/to/file1.css",
        warnings: [
          {
            line: 10,
            column: 5,
            endLine: 10,
            endColumn: 15,
            severity: "error",
            text: "Unexpected empty block",
            rule: "block-no-empty",
          },
          {
            line: 20,
            column: 8,
            severity: "warning",
            text: "Expected indentation of 2 spaces",
            rule: "indentation",
          },
        ],
      },
      {
        source: "/path/to/file2.css",
        warnings: [
          {
            line: 5,
            column: 1,
            severity: "error",
            text: "Unknown property",
            rule: "property-no-unknown",
          },
        ],
      },
    ]);
    const result = parseStylelintOutput(input, "/test/cwd");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      file: "/path/to/file1.css",
      line: 10,
      column: 5,
      endLine: 10,
      endColumn: 15,
      severity: "error",
      message: "Unexpected empty block",
      code: "block-no-empty",
      source: "stylelint",
    });
    expect(result[1]).toEqual({
      file: "/path/to/file1.css",
      line: 20,
      column: 8,
      endLine: undefined,
      endColumn: undefined,
      severity: "warning",
      message: "Expected indentation of 2 spaces",
      code: "indentation",
      source: "stylelint",
    });
    expect(result[2]).toEqual({
      file: "/path/to/file2.css",
      line: 5,
      column: 1,
      endLine: undefined,
      endColumn: undefined,
      severity: "error",
      message: "Unknown property",
      code: "property-no-unknown",
      source: "stylelint",
    });
  });

  it("returns empty array for invalid JSON", () => {
    const result = parseStylelintOutput("not json", "/test/cwd");
    expect(result).toEqual([]);
  });

  it("handles warnings without severity (defaults to warning)", () => {
    const input = JSON.stringify([
      {
        source: "/path/to/file.css",
        warnings: [
          {
            line: 10,
            column: 5,
            text: "Generic warning",
            rule: "test-rule",
          },
        ],
      },
    ]);
    const result = parseStylelintOutput(input, "/test/cwd");
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warning");
  });
});

// ── Branch coverage: fallback/default paths ──────────────────────────

describe("parsers branch coverage: fallback paths", () => {
  describe("parseBiomeOutput fallbacks", () => {
    it("handles diagnostic with no location path (empty string)", () => {
      const input = JSON.stringify({
        diagnostics: [
          {
            location: { path: undefined, start: { line: 5, column: 3 } },
            severity: "warning",
            message: "Warning",
          },
        ],
      });
      const result = parseBiomeOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("");
    });

    it("handles diagnostic with no start location (defaults)", () => {
      const input = JSON.stringify({
        diagnostics: [
          {
            location: { path: "/file.ts" },
            severity: "something",
            message: "Test",
          },
        ],
      });
      const result = parseBiomeOutput(input, "/test/cwd");
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].severity).toBe("info");
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].code).toBeUndefined();
    });

    it("handles output with no { in stdout", () => {
      const result = parseBiomeOutput("no json here", "/test/cwd");
      expect(result).toEqual([]);
    });

    it("handles JSON without diagnostics key", () => {
      const result = parseBiomeOutput('{"other": []}', "/test/cwd");
      expect(result).toEqual([]);
    });

    it("handles diagnostic with empty message", () => {
      const input = JSON.stringify({
        diagnostics: [{ severity: "error", message: "" }],
      });
      const result = parseBiomeOutput(input, "/test/cwd");
      expect(result[0].message).toBe("");
    });
  });

  describe("parseRuffOutput fallbacks", () => {
    it("handles result with missing fields", () => {
      const input = JSON.stringify([{}]);
      const result = parseRuffOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("");
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].severity).toBe("warning");
      expect(result[0].message).toBe("");
      expect(result[0].code).toBeUndefined();
    });

    it("handles non-array JSON", () => {
      const result = parseRuffOutput("{}", "/test/cwd");
      expect(result).toEqual([]);
    });
  });

  describe("parsePylintOutput fallbacks", () => {
    it("handles result with missing fields", () => {
      const input = JSON.stringify([{}]);
      const result = parsePylintOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("");
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].severity).toBe("info");
      expect(result[0].message).toBe("");
      expect(result[0].code).toBeUndefined();
    });

    it("handles non-array JSON", () => {
      const result = parsePylintOutput("{}", "/test/cwd");
      expect(result).toEqual([]);
    });

    it("handles null column (defaults to 0+1=1)", () => {
      const input = JSON.stringify([
        { path: "/f.py", line: 5, column: null, type: "warning", message: "m" },
      ]);
      const result = parsePylintOutput(input, "/test/cwd");
      expect(result[0].column).toBe(1);
    });

    it("handles null line (defaults to 1)", () => {
      const input = JSON.stringify([
        { path: "/f.py", line: null, column: 0, type: "warning", message: "m" },
      ]);
      const result = parsePylintOutput(input, "/test/cwd");
      expect(result[0].line).toBe(1);
    });

    it("falls back to message-id when symbol is absent", () => {
      const input = JSON.stringify([
        { path: "/f.py", line: 5, column: 0, type: "warning", message: "m", "message-id": "W0001" },
      ]);
      const result = parsePylintOutput(input, "/test/cwd");
      expect(result[0].code).toBe("W0001");
    });

    it("handles endColumn of 0", () => {
      const input = JSON.stringify([
        {
          path: "/f.py",
          line: 5,
          column: 0,
          endLine: 5,
          endColumn: 0,
          type: "warning",
          message: "m",
        },
      ]);
      const result = parsePylintOutput(input, "/test/cwd");
      expect(result[0].endColumn).toBeUndefined();
    });
  });

  describe("parseMypyOutput fallbacks", () => {
    it("handles entry with missing fields", () => {
      const input = JSON.stringify({
        file: "/path/to/file.py",
        message: "Test",
      });
      const result = parseMypyOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].severity).toBe("warning");
      expect(result[0].code).toBeUndefined();
    });

    it("handles null column (defaults to 0+1=1)", () => {
      const input = JSON.stringify({
        file: "/f.py",
        line: 5,
        column: null,
        severity: "error",
        message: "m",
      });
      const result = parseMypyOutput(input, "/test/cwd");
      expect(result[0].column).toBe(1);
    });

    it("handles null line (defaults to 1)", () => {
      const input = JSON.stringify({
        file: "/f.py",
        line: null,
        column: 0,
        severity: "error",
        message: "m",
      });
      const result = parseMypyOutput(input, "/test/cwd");
      expect(result[0].line).toBe(1);
    });

    it("handles end_column of 0", () => {
      const input = JSON.stringify({
        file: "/f.py",
        line: 5,
        column: 0,
        end_column: 0,
        severity: "error",
        message: "m",
      });
      const result = parseMypyOutput(input, "/test/cwd");
      expect(result[0].endColumn).toBeUndefined();
    });
  });

  describe("parseClippyOutput fallbacks", () => {
    it("handles span with missing fields", () => {
      const input = JSON.stringify({
        reason: "compiler-message",
        message: {
          spans: [{}],
          level: "warning",
          message: "Test warning",
        },
      });
      const result = parseClippyOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].file).toContain("/");
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].code).toBeUndefined();
    });

    it("handles entry without message", () => {
      const input = JSON.stringify({
        reason: "compiler-message",
        message: {
          level: "error",
          message: "",
          code: null,
        },
      });
      const result = parseClippyOutput(input, "/test/cwd");
      // No spans and no message → empty result
      expect(result).toHaveLength(0);
    });

    it("handles clippy entry with empty spans and empty message", () => {
      const input = JSON.stringify({
        reason: "compiler-message",
        message: {
          spans: [],
          level: "error",
          message: "",
          code: null,
        },
      });
      const result = parseClippyOutput(input, "/test/cwd");
      expect(result).toHaveLength(0);
    });

    it("skips non-JSON line", () => {
      const result = parseClippyOutput("not json\nalso not json", "/test/cwd");
      expect(result).toEqual([]);
    });
  });

  describe("parseStaticcheckOutput fallbacks", () => {
    it("handles JSON entry with missing fields", () => {
      const input = JSON.stringify({});
      const result = parseStaticcheckOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].file).toContain("/");
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].severity).toBe("warning");
      expect(result[0].message).toBe("");
      expect(result[0].code).toBeUndefined();
    });

    it("handles non-matching text line", () => {
      const result = parseStaticcheckOutput("not a valid line", "/test/cwd");
      expect(result).toEqual([]);
    });
  });

  describe("parseRubocopOutput fallbacks", () => {
    it("handles offense with missing fields", () => {
      const input = JSON.stringify({
        files: [{ path: "/f.rb", offenses: [{}] }],
      });
      const result = parseRubocopOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].severity).toBe("warning");
      expect(result[0].message).toBe("");
      expect(result[0].code).toBeUndefined();
    });

    it("handles JSON without files key", () => {
      const result = parseRubocopOutput("{}", "/test/cwd");
      expect(result).toEqual([]);
    });

    it("handles file entry with no path", () => {
      const input = JSON.stringify({
        files: [{ offenses: [{ severity: "error", message: "m" }] }],
      });
      const result = parseRubocopOutput(input, "/test/cwd");
      expect(result[0].file).toBe("");
    });
  });

  describe("parseShellcheckOutput fallbacks", () => {
    it("handles result with missing fields", () => {
      const input = JSON.stringify([{}]);
      const result = parseShellcheckOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].file).toBe("");
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].severity).toBe("info");
      expect(result[0].message).toBe("");
      expect(result[0].code).toBeUndefined();
    });

    it("handles non-array JSON", () => {
      const result = parseShellcheckOutput("{}", "/test/cwd");
      expect(result).toEqual([]);
    });

    it("handles result with code 0 (no SC prefix)", () => {
      const input = JSON.stringify([
        { file: "/f.sh", line: 1, column: 1, level: "error", message: "m", code: 0 },
      ]);
      const result = parseShellcheckOutput(input, "/test/cwd");
      expect(result[0].code).toBeUndefined();
    });
  });

  describe("parseStylelintOutput fallbacks", () => {
    it("handles warning with missing fields", () => {
      const input = JSON.stringify([{ source: "/f.css", warnings: [{}] }]);
      const result = parseStylelintOutput(input, "/test/cwd");
      expect(result).toHaveLength(1);
      expect(result[0].line).toBe(1);
      expect(result[0].column).toBe(1);
      expect(result[0].endLine).toBeUndefined();
      expect(result[0].endColumn).toBeUndefined();
      expect(result[0].severity).toBe("warning");
      expect(result[0].message).toBe("");
      expect(result[0].code).toBeUndefined();
    });

    it("handles non-array JSON", () => {
      const result = parseStylelintOutput("{}", "/test/cwd");
      expect(result).toEqual([]);
    });

    it("handles file result without source", () => {
      const input = JSON.stringify([{ warnings: [{ line: 1, column: 1, text: "m" }] }]);
      const result = parseStylelintOutput(input, "/test/cwd");
      expect(result[0].file).toBe("");
    });
  });
});
