import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderLensDiagnostics, type LensDiagnosticDetails } from "../renderer.js";
import { type CheckStatus } from "../types.js";

// ── Shared mock theme ─────────────────────────────────────────────────

const mockTheme = {
  fg: vi.fn((color: string, text: string) => `[fg:${color}]${text}[/fg]`),
  bg: vi.fn((color: string, text: string) => `[bg:${color}]${text}[/bg]`),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────

function makeDetails(overrides: Partial<LensDiagnosticDetails> = {}): LensDiagnosticDetails {
  return {
    statuses: {
      prettier: "clean",
      linters: "clean",
      lsp: "clean",
      tsc: "clean",
    },
    hasIssues: false,
    fileCount: 3,
    durationMs: 120,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════

describe("renderLensDiagnostics", () => {
  // 1. All-clean status
  it("renders all-clean status", () => {
    const details = makeDetails();
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Should produce a single summary line
    expect(result.length).toBe(1);

    // Summary line should contain the expected format
    expect(result[0]).toContain("pi-lens: 3 file(s) (120ms)");

    // The summary line should contain all check labels joined by •
    expect(result[0]).toContain("prettier");
    expect(result[0]).toContain("linters");
    expect(result[0]).toContain("lsp");
    expect(result[0]).toContain("tsc");
    expect(result[0]).toContain(" • ");

    // Entire line colored with success
    expect(mockTheme.fg).toHaveBeenCalledWith("success", expect.stringContaining("pi-lens:"));
  });

  // 2. Issues status
  it("renders issues status", () => {
    const details = makeDetails({
      statuses: {
        prettier: "clean",
        linters: "issues",
        lsp: "clean",
        tsc: "clean",
      },
      hasIssues: true,
    });
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Should produce a single summary line
    expect(result.length).toBe(1);

    // Summary line should include duration
    expect(result[0]).toContain("120ms");

    // Summary line should contain linters
    expect(result[0]).toContain("linters");

    // Entire line colored with warning (hasIssues)
    expect(mockTheme.fg).toHaveBeenCalledWith("warning", expect.stringContaining("pi-lens:"));
  });

  // 3. Error status
  it("renders error status", () => {
    const details = makeDetails({
      statuses: {
        prettier: "clean",
        linters: "clean",
        lsp: "clean",
        tsc: "error",
      },
      hasIssues: true,
    });
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Summary line should contain tsc
    expect(result[0]).toContain("tsc");
  });

  // 4. Skipped status
  it("renders skipped status", () => {
    const details = makeDetails({
      statuses: {
        prettier: "skipped",
        linters: "clean",
        lsp: "clean",
        tsc: "clean",
      },
      hasIssues: false,
    });
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Summary line should contain prettier
    expect(result[0]).toContain("prettier");
  });

  // 5. Running/pending status
  it("renders running/pending status", () => {
    const details = makeDetails({
      statuses: {
        prettier: "clean",
        linters: "clean",
        lsp: "running",
        tsc: "clean",
      },
      hasIssues: false,
    });
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Summary line should contain lsp
    expect(result[0]).toContain("lsp");
  });

  // 6. Expanded sectionsText
  it("renders expanded sectionsText", () => {
    const sectionContent = "2 issues found\n  src/foo.ts:10:5 - missing semicolon";
    const details = makeDetails({
      sectionsText: sectionContent,
      hasIssues: true,
      statuses: {
        prettier: "clean",
        linters: "issues",
        lsp: "clean",
        tsc: "clean",
      },
    });
    const result = renderLensDiagnostics({ details }, { expanded: true }, mockTheme).render(80);

    // First line is the summary
    expect(result[0]).toContain("pi-lens:");

    // Should include the section text lines after blank separator
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("2 issues found")]));
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("missing semicolon")]));
  });

  // 7. Collapsed without sectionsText
  it("renders collapsed without sectionsText", () => {
    const sectionContent = "secret detail line";
    const details = makeDetails({
      sectionsText: sectionContent,
    });
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Should NOT include the detail lines
    expect(result.every((line) => !line.includes("secret detail line"))).toBe(true);
  });

  // 8. Missing details
  it("handles missing details gracefully", () => {
    const result = renderLensDiagnostics(
      { content: "some message" },
      { expanded: false },
      mockTheme,
    ).render(80);

    // Should render a fallback message
    expect(result).toEqual(
      expect.arrayContaining([expect.stringContaining("no diagnostic details available")]),
    );

    // Should use muted color for the fallback
    expect(mockTheme.fg).toHaveBeenCalledWith(
      "muted",
      expect.stringContaining("no diagnostic details available"),
    );
  });

  // 9. Unknown status values
  it("handles unknown status values", () => {
    const details = makeDetails({
      statuses: {
        prettier: "bogus_status" as unknown as CheckStatus,
        linters: "clean",
        lsp: "clean",
        tsc: "clean",
      },
      hasIssues: false,
    });
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Should still render without crashing
    expect(result.length).toBeGreaterThan(0);

    // Summary line should still contain prettier
    expect(result[0]).toContain("prettier");
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("catches exceptions and returns error fallback", () => {
      const maliciousDetails = {
        hasIssues: false,
        fileCount: 1,
        durationMs: 100,
      };
      Object.defineProperty(maliciousDetails, "statuses", {
        get() {
          throw new Error("boom");
        },
      });
      const result = renderLensDiagnostics(
        { details: maliciousDetails as LensDiagnosticDetails },
        { expanded: false },
        mockTheme,
      );
      const lines = result.render(80);
      expect(lines).toEqual(
        expect.arrayContaining([expect.stringContaining("error rendering diagnostics")]),
      );
      expect(mockTheme.fg).toHaveBeenCalledWith(
        "error",
        expect.stringContaining("error rendering diagnostics"),
      );
    });
  });
});
