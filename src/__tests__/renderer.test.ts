import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderLensDiagnostics, type LensDiagnosticDetails } from "../renderer.js";

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

    // Header should say "all clean"
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("all clean")]));

    // Each check gets ✅ with success color
    expect(mockTheme.fg).toHaveBeenCalledWith("success", "✅");
    expect(mockTheme.fg).toHaveBeenCalledWith("success", "clean");

    // Four status lines for prettier, linters, lsp, tsc
    expect(result.filter((line) => line.includes("prettier:")).length).toBe(1);
    expect(result.filter((line) => line.includes("linters:")).length).toBe(1);
    expect(result.filter((line) => line.includes("lsp:")).length).toBe(1);
    expect(result.filter((line) => line.includes("tsc:")).length).toBe(1);
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

    // Header should NOT say "all clean"
    expect(result.some((line) => line.includes("all clean"))).toBe(false);

    // Header should include duration
    expect(result[0]).toContain("120ms");

    // Linters should have ⚠ with warning color
    expect(mockTheme.fg).toHaveBeenCalledWith("warning", "⚠");
    expect(mockTheme.fg).toHaveBeenCalledWith("warning", "issues");

    // Linters line should exist
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("linters:")]));
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

    // tsc line should have ✗ with error color
    expect(mockTheme.fg).toHaveBeenCalledWith("error", "✗");
    expect(mockTheme.fg).toHaveBeenCalledWith("error", "error");

    // tsc line should exist
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("tsc:")]));
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

    // Prettier should show ⊘ with dim color
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "⊘");
    expect(mockTheme.fg).toHaveBeenCalledWith("dim", "skipped");

    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("prettier:")]));
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

    // LSP should show ● with muted color
    expect(mockTheme.fg).toHaveBeenCalledWith("muted", "●");
    expect(mockTheme.fg).toHaveBeenCalledWith("muted", "running");

    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("lsp:")]));
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

    // Should include the section text lines
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
        prettier: "bogus_status" as string,
        linters: "clean",
        lsp: "clean",
        tsc: "clean",
      },
      hasIssues: false,
    });
    const result = renderLensDiagnostics({ details }, { expanded: false }, mockTheme).render(80);

    // Should still render without crashing
    expect(result.length).toBeGreaterThan(0);

    // The unknown status should use muted ● icon and pass the raw status to the label
    expect(mockTheme.fg).toHaveBeenCalledWith("muted", "●");
    expect(mockTheme.fg).toHaveBeenCalledWith("muted", "bogus_status");

    // Prettier line should still exist
    expect(result).toEqual(expect.arrayContaining([expect.stringContaining("prettier:")]));
  });
});
