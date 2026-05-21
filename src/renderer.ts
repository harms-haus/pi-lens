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

function renderStatusIcon(status: string, theme: Theme): string {
  switch (status) {
    case "clean":
      return theme.fg("success", "✅");
    case "issues":
      return theme.fg("warning", "⚠");
    case "error":
      return theme.fg("error", "✗");
    case "skipped":
      return theme.fg("dim", "⊘");
    case "running":
    case "pending":
      return theme.fg("muted", "●");
    default:
      return theme.fg("muted", "●");
  }
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b[\x5c][^\x20-\x7E\t\r\n]/g,
    "",
  );
}

function renderStatusLabel(status: string, theme: Theme): string {
  switch (status) {
    case "clean":
      return theme.fg("success", "clean");
    case "issues":
      return theme.fg("warning", "issues");
    case "error":
      return theme.fg("error", "error");
    case "skipped":
      return theme.fg("dim", "skipped");
    case "running":
      return theme.fg("muted", "running");
    case "pending":
      return theme.fg("muted", "pending");
    default:
      return theme.fg("muted", status);
  }
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

    // ── Header line ─────────────────────────────────────────────────
    if (details.hasIssues) {
      lines.push(
        theme.fg(
          "warning",
          `🔍 pi-lens: ${details.fileCount} file(s) checked — issues found (${details.durationMs}ms)`,
        ),
      );
    } else {
      lines.push(
        theme.fg(
          "success",
          `🔍 pi-lens: ${details.fileCount} file(s) checked — all clean (${details.durationMs}ms)`,
        ),
      );
    }

    // ── Status lines ────────────────────────────────────────────────
    const checks: Array<{ label: string; status: string }> = [
      { label: "prettier", status: details.statuses.prettier },
      { label: "linters", status: details.statuses.linters },
      { label: "lsp", status: details.statuses.lsp },
      { label: "tsc", status: details.statuses.tsc },
    ];

    for (const check of checks) {
      const icon = renderStatusIcon(check.status, theme);
      const statusLabel = renderStatusLabel(check.status, theme);
      lines.push(`  ${icon} ${check.label}: ${statusLabel}`);
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
