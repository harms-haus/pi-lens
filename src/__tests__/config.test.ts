import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
}));

// Mock node:os to return a fixed home directory
vi.mock("node:os", () => ({
  homedir: () => "/home/testuser",
}));

import { loadConfig, loadRendererSetting, DEFAULT_CONFIG } from "../config.js";

const CWD = "/home/user/project";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── DEFAULT_CONFIG ──────────────────────────────────────────────────

describe("DEFAULT_CONFIG", () => {
  it("has all expected fields with correct defaults", () => {
    expect(DEFAULT_CONFIG).toEqual({
      prettier: true,
      linters: true,
      lsp: true,
      tsc: true,
      includePatterns: [],
      excludePatterns: ["node_modules/**", ".git/**", "dist/**", "build/**"],
      lspDelayMs: 1000,
      maxConcurrency: 4,
      prettierTimeoutMs: 15_000,
      linterTimeoutMs: 15_000,
      tscTimeoutMs: 30_000,
      bashDetection: true,
      alwaysReport: true,
    });
  });

  it("all boolean check flags default to true", () => {
    expect(DEFAULT_CONFIG.prettier).toBe(true);
    expect(DEFAULT_CONFIG.linters).toBe(true);
    expect(DEFAULT_CONFIG.lsp).toBe(true);
    expect(DEFAULT_CONFIG.tsc).toBe(true);
    expect(DEFAULT_CONFIG.bashDetection).toBe(true);
    expect(DEFAULT_CONFIG.alwaysReport).toBe(true);
  });

  it("all timeout values are positive numbers", () => {
    expect(DEFAULT_CONFIG.prettierTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.linterTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.tscTimeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.lspDelayMs).toBeGreaterThan(0);
  });
});

// ── loadConfig ──────────────────────────────────────────────────────

describe("loadConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const config = loadConfig(CWD);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges valid config with defaults", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        prettier: false,
        tsc: false,
        lspDelayMs: 2000,
      }),
    );

    const config = loadConfig(CWD);
    expect(config.prettier).toBe(false);
    expect(config.tsc).toBe(false);
    expect(config.lspDelayMs).toBe(2000);
    // Defaults preserved
    expect(config.linters).toBe(true);
    expect(config.lsp).toBe(true);
    expect(config.maxConcurrency).toBe(4);
    expect(config.alwaysReport).toBe(true);
  });

  it("merges partial config preserving defaults", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ prettier: false }));

    const config = loadConfig(CWD);
    expect(config.prettier).toBe(false);
    expect(config.linters).toBe(true);
    expect(config.lsp).toBe(true);
    expect(config.tsc).toBe(true);
  });

  it("returns defaults for malformed JSON", async () => {
    const { readFileSync } = await import("node:fs");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(readFileSync).mockReturnValue("{ invalid json");

    const config = loadConfig(CWD);
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns defaults for non-object JSON", async () => {
    const { readFileSync } = await import("node:fs");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(readFileSync).mockReturnValue("42");

    const config = loadConfig(CWD);
    expect(config).toEqual(DEFAULT_CONFIG);
    warnSpy.mockRestore();
  });

  it("returns defaults for array JSON", async () => {
    const { readFileSync } = await import("node:fs");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(readFileSync).mockReturnValue("[1, 2, 3]");

    const config = loadConfig(CWD);
    expect(config).toEqual(DEFAULT_CONFIG);
    warnSpy.mockRestore();
  });

  it("ignores unknown keys", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        unknownKey: "value",
        anotherUnknown: 42,
        prettier: false,
      }),
    );

    const config = loadConfig(CWD);
    expect(config.prettier).toBe(false);
    expect((config as unknown as Record<string, unknown>).unknownKey).toBeUndefined();
  });

  it("ignores wrong-typed values and uses defaults", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        prettier: "yes",
        lspDelayMs: "fast",
        maxConcurrency: "many",
        excludePatterns: "all",
      }),
    );

    const config = loadConfig(CWD);
    // Wrong type string → default true
    expect(config.prettier).toBe(true);
    // Wrong type string → default 1000
    expect(config.lspDelayMs).toBe(1000);
    // Wrong type string → default 4
    expect(config.maxConcurrency).toBe(4);
    // Wrong type string → default array
    expect(config.excludePatterns).toEqual(["node_modules/**", ".git/**", "dist/**", "build/**"]);
  });

  it("accepts valid string arrays for patterns", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        excludePatterns: ["custom/**"],
        includePatterns: ["src/**"],
      }),
    );

    const config = loadConfig(CWD);
    expect(config.excludePatterns).toEqual(["custom/**"]);
    expect(config.includePatterns).toEqual(["src/**"]);
  });

  it("ignores array with non-string elements", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        excludePatterns: ["valid/**", 123, true],
      }),
    );

    const config = loadConfig(CWD);
    // Mixed array should be rejected
    expect(config.excludePatterns).toEqual(DEFAULT_CONFIG.excludePatterns);
  });
});

// ── loadRendererSetting ─────────────────────────────────────────────

describe("loadRendererSetting", () => {
  it("returns false when settings.json does not exist", async () => {
    const { readFileSync } = await import("node:fs");
    const err = new Error("ENOENT: no such file") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    vi.mocked(readFileSync).mockImplementation(() => {
      throw err;
    });

    const result = loadRendererSetting();
    expect(result).toBe(false);
  });

  it("returns true when piLensRenderer is true", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ piLensRenderer: true }));

    const result = loadRendererSetting();
    expect(result).toBe(true);
  });

  it("returns false when piLensRenderer is false", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ piLensRenderer: false }));

    const result = loadRendererSetting();
    expect(result).toBe(false);
  });

  it("returns false when piLensRenderer field is missing", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}));

    const result = loadRendererSetting();
    expect(result).toBe(false);
  });

  it("returns false when JSON is malformed", async () => {
    const { readFileSync } = await import("node:fs");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(readFileSync).mockReturnValue("not valid json");

    const result = loadRendererSetting();
    expect(result).toBe(false);
    warnSpy.mockRestore();
  });

  it("returns false when JSON is not an object", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue("null");

    const result = loadRendererSetting();
    expect(result).toBe(false);
  });

  it("returns false when piLensRenderer is wrong type", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ piLensRenderer: "yes" }));

    const result = loadRendererSetting();
    expect(result).toBe(false);
  });
});
