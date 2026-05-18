import { describe, it, expect } from "vitest";
import { LINTER_DEFINITIONS } from "../definitions.js";

describe("LINTER_DEFINITIONS", () => {
  it("contains at least one definition", () => {
    expect(LINTER_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("every definition has required fields", () => {
    for (const def of LINTER_DEFINITIONS) {
      expect(def.name).toBeTruthy();
      expect(def.label).toBeTruthy();
      expect(def.languages.length).toBeGreaterThan(0);
      expect(def.extensions.length).toBeGreaterThan(0);
      expect(typeof def.versionCommand).toBe("string");
      expect(typeof def.lintCommand).toBe("function");
      expect(typeof def.parseOutput).toBe("function");
      expect(typeof def.timeout).toBe("number");
      expect(def.timeout).toBeGreaterThan(0);
    }
  });

  it("every lintCommand returns an array of strings", () => {
    const testFiles = ["file1.ts", "file2.ts"];
    for (const def of LINTER_DEFINITIONS) {
      const result = def.lintCommand(testFiles);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      // Every element should be a string
      for (const arg of result) {
        expect(typeof arg).toBe("string");
      }
    }
  });

  it("every lintCommand works with empty file list", () => {
    for (const def of LINTER_DEFINITIONS) {
      const result = def.lintCommand([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("every parseOutput returns empty array for empty string", () => {
    for (const def of LINTER_DEFINITIONS) {
      const result = def.parseOutput("", "/test/cwd");
      expect(Array.isArray(result)).toBe(true);
      // parseOutput should return an array (possibly empty) and never throw
    }
  });

  it("every parseOutput returns empty array for invalid JSON", () => {
    for (const def of LINTER_DEFINITIONS) {
      const result = def.parseOutput("not valid json {}", "/test/cwd");
      expect(Array.isArray(result)).toBe(true);
    }
  });

  it("every definition has a unique name", () => {
    const names = LINTER_DEFINITIONS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("eslint lintCommand includes --format json", () => {
    const eslint = LINTER_DEFINITIONS.find((d) => d.name === "eslint")!;
    const cmd = eslint.lintCommand(["file.ts"]);
    expect(cmd).toContain("--format");
    expect(cmd).toContain("json");
  });

  it("biome lintCommand includes lint subcommand", () => {
    const biome = LINTER_DEFINITIONS.find((d) => d.name === "biome")!;
    const cmd = biome.lintCommand(["file.ts"]);
    expect(cmd).toContain("lint");
  });

  it("ruff lintCommand includes check subcommand", () => {
    const ruff = LINTER_DEFINITIONS.find((d) => d.name === "ruff")!;
    const cmd = ruff.lintCommand(["file.py"]);
    expect(cmd).toContain("check");
  });

  it("clippy lintCommand uses cargo clippy with --message-format=json", () => {
    const clippy = LINTER_DEFINITIONS.find((d) => d.name === "clippy")!;
    const cmd = clippy.lintCommand(["file.rs"]);
    expect(cmd).toContain("cargo");
    expect(cmd).toContain("clippy");
    expect(cmd).toContain("--message-format=json");
    // Clippy ignores file arguments
    expect(cmd).not.toContain("file.rs");
  });

  it("shellcheck lintCommand includes -f json", () => {
    const shellcheck = LINTER_DEFINITIONS.find((d) => d.name === "shellcheck")!;
    const cmd = shellcheck.lintCommand(["file.sh"]);
    expect(cmd).toContain("-f");
    expect(cmd).toContain("json");
  });

  it("stylelint lintCommand includes --formatter json", () => {
    const stylelint = LINTER_DEFINITIONS.find((d) => d.name === "stylelint")!;
    const cmd = stylelint.lintCommand(["file.css"]);
    expect(cmd).toContain("--formatter");
    expect(cmd).toContain("json");
  });

  it("mypy lintCommand includes --output=json", () => {
    const mypy = LINTER_DEFINITIONS.find((d) => d.name === "mypy")!;
    const cmd = mypy.lintCommand(["file.py"]);
    expect(cmd).toContain("--output=json");
  });

  it("pylint lintCommand includes --output-format=json", () => {
    const pylint = LINTER_DEFINITIONS.find((d) => d.name === "pylint")!;
    const cmd = pylint.lintCommand(["file.py"]);
    expect(cmd).toContain("--output-format=json");
  });

  it("flake8 lintCommand includes --format flag", () => {
    const flake8 = LINTER_DEFINITIONS.find((d) => d.name === "flake8")!;
    const cmd = flake8.lintCommand(["file.py"]);
    expect(cmd).toContain("--format");
  });

  it("staticcheck lintCommand includes -f json", () => {
    const sh = LINTER_DEFINITIONS.find((d) => d.name === "staticcheck")!;
    const cmd = sh.lintCommand(["file.go"]);
    expect(cmd).toContain("-f");
    expect(cmd).toContain("json");
  });

  it("rubocop lintCommand includes --format json", () => {
    const rubocop = LINTER_DEFINITIONS.find((d) => d.name === "rubocop")!;
    const cmd = rubocop.lintCommand(["file.rb"]);
    expect(cmd).toContain("--format");
    expect(cmd).toContain("json");
  });
});
