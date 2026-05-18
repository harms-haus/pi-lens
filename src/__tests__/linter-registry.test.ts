import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: { readdir: vi.fn() },
}));

vi.mock("../spawn-utils.js", () => ({
  execCommand: vi.fn(),
}));

import * as fs from "node:fs";
import { execCommand } from "../spawn-utils.js";
import {
  detectLinters,
  getLintersForFile,
  getCoveredExtensions,
  discoverFilesNative,
} from "../linter-registry.js";
import type { DetectedLinter } from "../types.js";

const mockedExecCommand = vi.mocked(execCommand);

describe("getLintersForFile", () => {
  it('returns ESLint for "/foo/bar.ts" when ESLint is detected', () => {
    const detected: DetectedLinter[] = [
      {
        definition: {
          name: "eslint",
          label: "ESLint",
          languages: ["javascript", "typescript"],
          extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"],
          configFiles: [".eslintrc.json"],
          projectMarkers: ["package.json"],
          versionCommand: "npx eslint --version",
          lintCommand: () => [
            "npx",
            "eslint",
            "--format",
            "json",
            "--no-error-on-unmatched-pattern",
          ],
          parseOutput: () => [],
          timeout: 15000,
        },
        configFile: "/foo/.eslintrc.json",
        version: "v9.0.0",
        detectionSource: "config-file",
      },
    ];

    const result = getLintersForFile("/foo/bar.ts", detected);
    expect(result).toHaveLength(1);
    expect(result[0].definition.name).toBe("eslint");
  });

  it('returns Ruff for "/foo/bar.py" when Ruff is detected', () => {
    const detected: DetectedLinter[] = [
      {
        definition: {
          name: "ruff",
          label: "Ruff",
          languages: ["python"],
          extensions: [".py", ".pyi", ".ipynb"],
          configFiles: ["ruff.toml"],
          projectMarkers: ["pyproject.toml"],
          versionCommand: "ruff --version",
          lintCommand: () => ["ruff", "check", "--output-format=json"],
          parseOutput: () => [],
          timeout: 15000,
        },
        configFile: "/foo/ruff.toml",
        version: "v1.0.0",
        detectionSource: "config-file",
      },
    ];

    const result = getLintersForFile("/foo/bar.py", detected);
    expect(result).toHaveLength(1);
    expect(result[0].definition.name).toBe("ruff");
  });

  it('returns [] for "/foo/bar.txt" as it has no matching linter', () => {
    const detected: DetectedLinter[] = [
      {
        definition: {
          name: "eslint",
          label: "ESLint",
          languages: ["javascript", "typescript"],
          extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"],
          configFiles: [".eslintrc.json"],
          projectMarkers: ["package.json"],
          versionCommand: "npx eslint --version",
          lintCommand: () => [
            "npx",
            "eslint",
            "--format",
            "json",
            "--no-error-on-unmatched-pattern",
          ],
          parseOutput: () => [],
          timeout: 15000,
        },
        configFile: "/foo/.eslintrc.json",
        version: "v9.0.0",
        detectionSource: "config-file",
      },
    ];

    const result = getLintersForFile("/foo/bar.txt", detected);
    expect(result).toEqual([]);
  });

  it('returns [] for "/foo/bar.rs" when Clippy is not detected', () => {
    const detected: DetectedLinter[] = [
      {
        definition: {
          name: "eslint",
          label: "ESLint",
          languages: ["javascript", "typescript"],
          extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"],
          configFiles: [".eslintrc.json"],
          projectMarkers: ["package.json"],
          versionCommand: "npx eslint --version",
          lintCommand: () => [
            "npx",
            "eslint",
            "--format",
            "json",
            "--no-error-on-unmatched-pattern",
          ],
          parseOutput: () => [],
          timeout: 15000,
        },
        configFile: "/foo/.eslintrc.json",
        version: "v9.0.0",
        detectionSource: "config-file",
      },
    ];

    const result = getLintersForFile("/foo/bar.rs", detected);
    expect(result).toEqual([]);
  });
});

describe("getCoveredExtensions", () => {
  it("returns sorted unique extensions when ESLint and Ruff are detected", () => {
    const detected: DetectedLinter[] = [
      {
        definition: {
          name: "eslint",
          label: "ESLint",
          languages: ["javascript", "typescript"],
          extensions: [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"],
          configFiles: [".eslintrc.json"],
          projectMarkers: ["package.json"],
          versionCommand: "npx eslint --version",
          lintCommand: () => [
            "npx",
            "eslint",
            "--format",
            "json",
            "--no-error-on-unmatched-pattern",
          ],
          parseOutput: () => [],
          timeout: 15000,
        },
        configFile: "/foo/.eslintrc.json",
        version: "v9.0.0",
        detectionSource: "config-file",
      },
      {
        definition: {
          name: "ruff",
          label: "Ruff",
          languages: ["python"],
          extensions: [".py", ".pyi", ".ipynb"],
          configFiles: ["ruff.toml"],
          projectMarkers: ["pyproject.toml"],
          versionCommand: "ruff --version",
          lintCommand: () => ["ruff", "check", "--output-format=json"],
          parseOutput: () => [],
          timeout: 15000,
        },
        configFile: "/foo/ruff.toml",
        version: "v1.0.0",
        detectionSource: "config-file",
      },
    ];

    const result = getCoveredExtensions(detected);
    expect(result).toEqual([
      ".cjs",
      ".ipynb",
      ".js",
      ".jsx",
      ".mjs",
      ".py",
      ".pyi",
      ".svelte",
      ".ts",
      ".tsx",
      ".vue",
    ]);
  });
});

describe("detectLinters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ESLint with version when config file found and installed", async () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);

    mockedExistsSync.mockImplementation((p) => {
      if (p === "/test/.eslintrc.json") return true;
      if (p === "/test/package.json") return false;
      return false;
    });

    mockedExecCommand.mockResolvedValue({
      stdout: "v9.0.0",
      stderr: "",
      exitCode: 0,
    });

    const result = await detectLinters("/test");

    expect(result).toHaveLength(1);
    expect(result[0].definition.name).toBe("eslint");
    expect(result[0].version).toBe("v9.0.0");
    expect(result[0].configFile).toBe("/test/.eslintrc.json");
    expect(result[0].detectionSource).toBe("config-file");
  });

  it("returns [] when config found but not installed", async () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);

    mockedExistsSync.mockImplementation((p) => {
      if (p === "/test/.eslintrc.json") return true;
      if (p === "/test/package.json") return false;
      return false;
    });

    mockedExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "command not found",
      exitCode: 1,
    });

    const result = await detectLinters("/test");

    expect(result).toEqual([]);
  });

  it("returns matching linter when package.json key found", async () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);
    const mockedReadFileSync = vi.mocked(fs.readFileSync);

    mockedExistsSync.mockImplementation((p) => {
      if (p === "/test/package.json") return true;
      return false;
    });

    mockedReadFileSync.mockImplementation((p) => {
      if (p === "/test/package.json") {
        return JSON.stringify({
          devDependencies: {
            eslint: "^8.0.0",
          },
        });
      }
      return "";
    });

    // All version checks succeed for eslint command, fail for others
    mockedExecCommand.mockImplementation((cmd, _args, _opts) => {
      if (cmd === "npx" || cmd.includes("eslint")) {
        return Promise.resolve({ stdout: "v8.57.0", stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "not found", exitCode: 1 });
    });

    const result = await detectLinters("/test");

    expect(result).toHaveLength(1);
    expect(result[0].definition.name).toBe("eslint");
    expect(result[0].version).toBe("v8.57.0");
    expect(result[0].detectionSource).toBe("package-key");
  });

  it("returns [] when nothing found", async () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);

    mockedExistsSync.mockReturnValue(false);

    mockedExecCommand.mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });

    const result = await detectLinters("/test");

    expect(result).toEqual([]);
  });

  it("detects ruff via pyproject.toml section", async () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);
    const mockedReadFileSync = vi.mocked(fs.readFileSync);

    mockedExistsSync.mockImplementation((p) => {
      if (p === "/test/pyproject.toml") return true;
      return false;
    });

    mockedReadFileSync.mockImplementation((p) => {
      if (p === "/test/pyproject.toml") {
        return "[tool.ruff]\nline-length = 88\n";
      }
      return "";
    });

    mockedExecCommand.mockImplementation((cmd, _args, _opts) => {
      if (cmd === "ruff") {
        return Promise.resolve({ stdout: "ruff v1.0.0", stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "not found", exitCode: 1 });
    });

    const result = await detectLinters("/test");

    expect(result).toHaveLength(1);
    expect(result[0].definition.name).toBe("ruff");
    expect(result[0].version).toBe("ruff v1.0.0");
    expect(result[0].configFile).toBe("/test/pyproject.toml");
    expect(result[0].detectionSource).toBe("config-file");
  });

  it("detects linter via project markers", async () => {
    const mockedExistsSync = vi.mocked(fs.existsSync);

    mockedExistsSync.mockImplementation((p) => {
      if (p === "/test/go.mod") return true;
      return false;
    });

    mockedExecCommand.mockImplementation((cmd, _args, _opts) => {
      if (cmd === "staticcheck") {
        return Promise.resolve({ stdout: "v0.4.0", stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "not found", exitCode: 1 });
    });

    const result = await detectLinters("/test");

    expect(result).toHaveLength(1);
    expect(result[0].definition.name).toBe("staticcheck");
    expect(result[0].detectionSource).toBe("project-marker");
  });
});

describe("discoverFilesNative", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns file path for basic discovery with one matching file", async () => {
    const mockedReaddir = vi.mocked(fs.promises.readdir);

    const mockEntry = {
      name: "test.ts",
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Dirent;

    (mockedReaddir as ReturnType<typeof vi.fn>).mockResolvedValue([mockEntry] as unknown);

    const result = await discoverFilesNative("/test", [".ts"]);

    expect(result).toEqual(["/test/test.ts"]);
  });

  it("skips node_modules directory", async () => {
    const mockedReaddir = vi.mocked(fs.promises.readdir);

    const mockFileEntry = {
      name: "test.ts",
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Dirent;

    const mockNodeModulesEntry = {
      name: "node_modules",
      isDirectory: () => true,
      isFile: () => false,
    } as fs.Dirent;

    const mockInnerFileEntry = {
      name: "inside.ts",
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Dirent;

    (mockedReaddir as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) => {
      if (p === "/test") {
        return Promise.resolve([mockFileEntry, mockNodeModulesEntry]);
      }
      if (p === "/test/node_modules") {
        return Promise.resolve([mockInnerFileEntry]);
      }
      return Promise.resolve([] as fs.Dirent[]);
    });

    const result = await discoverFilesNative("/test", [".ts"]);

    expect(result).toEqual(["/test/test.ts"]);
    expect(mockedReaddir).not.toHaveBeenCalledWith("/test/node_modules", expect.anything());
  });

  it("skips dot-directories", async () => {
    const mockedReaddir = vi.mocked(fs.promises.readdir);

    const mockFileEntry = {
      name: "test.ts",
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Dirent;

    const mockHiddenDirEntry = {
      name: ".hidden",
      isDirectory: () => true,
      isFile: () => false,
    } as fs.Dirent;

    const mockInnerFileEntry = {
      name: "inside.ts",
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Dirent;

    (mockedReaddir as ReturnType<typeof vi.fn>).mockImplementation(async (p: string) => {
      if (p === "/test") {
        return Promise.resolve([mockFileEntry, mockHiddenDirEntry]);
      }
      if (p === "/test/.hidden") {
        return Promise.resolve([mockInnerFileEntry]);
      }
      return Promise.resolve([] as fs.Dirent[]);
    });

    const result = await discoverFilesNative("/test", [".ts"]);

    expect(result).toEqual(["/test/test.ts"]);
    expect(mockedReaddir).not.toHaveBeenCalledWith("/test/.hidden", expect.anything());
  });

  it("respects maxFiles limit", async () => {
    const mockedReaddir = vi.mocked(fs.promises.readdir);

    const mockEntries: fs.Dirent[] = [];
    for (let i = 1; i <= 10; i++) {
      mockEntries.push({
        name: `file${i}.ts`,
        isDirectory: () => false,
        isFile: () => true,
      } as fs.Dirent);
    }

    (mockedReaddir as ReturnType<typeof vi.fn>).mockResolvedValue(mockEntries);

    const result = await discoverFilesNative("/test", [".ts"], 3);

    expect(result).toHaveLength(3);
    expect(result).toEqual(["/test/file1.ts", "/test/file2.ts", "/test/file3.ts"]);
  });

  it("handles readdir permission error gracefully", async () => {
    const mockedReaddir = vi.mocked(fs.promises.readdir);

    mockedReaddir.mockRejectedValue(new Error("EACCES: permission denied"));

    const result = await discoverFilesNative("/test", [".ts"]);

    expect(result).toEqual([]);
  });

  it("returns [] for empty directory", async () => {
    const mockedReaddir = vi.mocked(fs.promises.readdir);

    mockedReaddir.mockResolvedValue([]);

    const result = await discoverFilesNative("/test", [".ts"]);

    expect(result).toEqual([]);
  });
});
