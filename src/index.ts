/**
 * pi-lens — Extension entry point
 *
 * Hooks after write/edit/bash tools and automatically runs prettier,
 * linters, LSP diagnostics, and tsc on changed files.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { detectLinters } from "./linter-registry.js";
import { LspManager, DEFAULT_IDLE_TIMEOUT_MS } from "./lsp-manager.js";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { resolveFilesFromToolResult, runChecks } from "./hook-runner.js";
import { isPrettierAvailable } from "./prettier-runner.js";
import { isTscAvailable } from "./tsc-runner.js";
import type { LensConfig, CheckStatus, LensStatusPayload, DetectedLinter } from "./types.js";

// ── State Interface ────────────────────────────────────────────────────

interface LensState {
  detectedLinters: DetectedLinter[];
  lspManager: LspManager | null;
  config: LensConfig;
  cwd: string;
  prettierAvailable: boolean;
  tscAvailable: boolean;
}

// ── Status Bar Helpers ─────────────────────────────────────────────────

function buildStatusPayload(
  state: LensState,
  checkStatuses?: {
    prettier: CheckStatus;
    linters: CheckStatus;
    lsp: CheckStatus;
    tsc: CheckStatus;
  },
): LensStatusPayload {
  const payload: LensStatusPayload = {
    prettier: state.prettierAvailable ? (checkStatuses?.prettier ?? "pending") : "skipped",
    linters: state.detectedLinters.length > 0 ? (checkStatuses?.linters ?? "pending") : "skipped",
    lsp: checkStatuses?.lsp ?? "pending",
    tsc: state.tscAvailable ? (checkStatuses?.tsc ?? "pending") : "skipped",
  };

  return payload;
}

// ── Main Extension ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  const state: LensState = {
    detectedLinters: [],
    lspManager: null,
    config: DEFAULT_CONFIG,
    cwd: process.cwd(),
    prettierAvailable: false,
    tscAvailable: false,
  };

  let currentCtx: ExtensionContext | undefined;
  let lastStatus: string | undefined;

  // ── Status Publishing ──────────────────────────────────────────────

  function publishStatus(checkStatuses?: {
    prettier: CheckStatus;
    linters: CheckStatus;
    lsp: CheckStatus;
    tsc: CheckStatus;
  }): void {
    if (!currentCtx?.hasUI) return;

    const payload = buildStatusPayload(state, checkStatuses);
    const json = JSON.stringify(payload);

    if (json !== lastStatus) {
      lastStatus = json;
      currentCtx.ui.setStatus("pi-lens", json);
    }
  }

  // ── Session Lifecycle ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    state.cwd = ctx.cwd;
    currentCtx = ctx;
    state.config = loadConfig(ctx.cwd);

    // Initialize LSP manager
    state.lspManager = new LspManager(ctx.cwd, DEFAULT_IDLE_TIMEOUT_MS);

    // Detect availability in parallel
    const [linters, prettier, tsc] = await Promise.all([
      detectLinters(ctx.cwd),
      isPrettierAvailable(ctx.cwd),
      isTscAvailable(ctx.cwd),
    ]);

    state.detectedLinters = linters;
    state.prettierAvailable = prettier;
    state.tscAvailable = tsc;

    // Notify UI with summary
    if (ctx.hasUI) {
      const parts: string[] = [];
      if (state.detectedLinters.length > 0) {
        const names = state.detectedLinters.map((l) => l.definition.label).join(", ");
        parts.push(`linters: ${names}`);
      }
      if (state.prettierAvailable) parts.push("prettier");
      if (state.tscAvailable) parts.push("tsc");
      parts.push("lsp");

      const summary = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
      ctx.ui.notify(`pi-lens: ready${summary}`, "info");
    }

    publishStatus();
  });

  pi.on("session_shutdown", async () => {
    if (state.lspManager) {
      await state.lspManager.stopAll();
      state.lspManager = null;
    }
    if (currentCtx?.hasUI) {
      currentCtx.ui.setStatus("pi-lens", undefined);
    }
    state.detectedLinters = [];
    state.prettierAvailable = false;
    state.tscAvailable = false;
    currentCtx = undefined;
    lastStatus = undefined;
  });

  // ── Hook: tool_result ──────────────────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    // Only hook write, edit, bash
    if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "bash") {
      return undefined;
    }

    // Don't process error results
    if (event.isError) return undefined;

    // Resolve affected files
    const files = resolveFilesFromToolResult(event.toolName, event.input, ctx.cwd, state.config);

    if (files.length === 0) return undefined;

    try {
      const result = await runChecks(files, ctx.cwd, state.config, state, ctx.signal);

      // Update status bar with check results
      publishStatus(result.statuses);

      // Always report (even when clean, per config.alwaysReport)
      if (result.text) {
        return {
          content: [...event.content, { type: "text" as const, text: result.text }],
        };
      }
      // No text means config.alwaysReport is false and all checks are clean
    } catch {
      // Never block the original tool result
    }

    return undefined;
  });
}
