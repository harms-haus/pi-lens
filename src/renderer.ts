/**
 * TUI Diagnostic Renderer for pi-lens
 *
 * Provides a custom message renderer registered via
 * `pi.registerMessageRenderer("pi-lens-diagnostics", renderer)` that displays
 * diagnostic results (prettier, linters, LSP, tsc) with proper colours in
 * the pi TUI.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface LensDiagnosticDetails {
  statuses: {
    prettier: string;
    linters: string;
    lsp: string;
    tsc: string;
  };
  hasIssues: boolean;
  fileCount: number;
  durationMs: number;
  sectionsText?: string;
}

// ── Minimal inline component ───────────────────────────────────────────
// We intentionally avoid importing from @earendil-works/pi-tui because that
// package is only available at runtime through pi-coding-agent.  The
// DiagnosticPanel satisfies the same `{ render(width: number): string[] }`
// contract that the TUI expects.

class DiagnosticPanel {
  constructor(private lines: string[]) {}
  render(_width: number): string[] {
    return this.lines;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

type Theme = {
  fg: (color: string, text: string) => string;
  bg: (color: string, text: string) => string;
};

function renderStatusIcon(status: string): string {
  switch (status) {
    case "clean":
      return "✅";
    case "issues":
      return "⚠";
    case "error":
      return "✗";
    case "skipped":
      return "⊘";
    case "running":
    case "pending":
      return "●";
    default:
      return "●";
  }
}

function stripAnsi(text: string): string {
  return text.replace(
    /* eslint-disable-next-line no-control-regex -- ANSI escape sequences must match control characters */
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b[\x5c][^\x20-\x7E\t\r\n]/g,
    "",
  );
}

// ── Public renderer ────────────────────────────────────────────────────

export function renderLensDiagnostics(
  message: { details?: LensDiagnosticDetails; content?: string },
  options: { expanded: boolean },
  theme: Theme,
): { render: (width: number) => string[] } {
  try {
    const lines: string[] = [];
    const details = message.details;

    if (!details) {
      lines.push(theme.fg("muted", "🔍 pi-lens: no diagnostic details available"));
      return new DiagnosticPanel(lines);
    }

    // ── Summary line ───────────────────────────────────────────────
    const checks = [
      { key: "prettier", label: "prettier" },
      { key: "linters", label: "linters" },
      { key: "lsp", label: "lsp" },
      { key: "tsc", label: "tsc" },
    ] as const;

    const checkParts = checks.map((check) => {
      const status = details.statuses[check.key];
      const icon = renderStatusIcon(status);
      return `${icon} ${check.label}`;
    });

    const summaryLine = `🔍 pi-lens: ${details.fileCount} file(s) (${details.durationMs}ms) - ${checkParts.join(" • ")}`;

    if (details.hasIssues) {
      lines.push(theme.fg("warning", summaryLine));
    } else {
      lines.push(theme.fg("success", summaryLine));
    }

    // ── Expanded detail text ────────────────────────────────────────
    if (options.expanded && details.sectionsText) {
      lines.push("");
      const sanitized = stripAnsi(details.sectionsText);
      for (const line of sanitized.split("\n")) {
        lines.push(`  ${line}`);
      }
    }

    return new DiagnosticPanel(lines);
  } catch {
    // Never throw from the renderer — return a safe fallback
    return new DiagnosticPanel([theme.fg("error", "🔍 pi-lens: error rendering diagnostics")]);
  }
}
