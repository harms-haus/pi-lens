/**
 * pi-lens — Extension entry point
 *
 * Hooks after write/edit/bash tools and automatically runs prettier,
 * linters, LSP diagnostics, and tsc on changed files via the code-lens daemon.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureDaemon, stopDaemon } from "@harms-haus/code-lens/client";
import { loadConfig, DEFAULT_CONFIG } from "./config.js";
import { resolveFilesFromToolResult, runChecks } from "./hook-runner.js";
import type { CheckStatus, LensStatusPayload } from "./types.js";
import type { LensState } from "./hook-runner.js";

// ── Status Bar Helpers ─────────────────────────────────────────────────

function buildStatusPayload(checkStatuses?: {
  prettier: CheckStatus;
  linters: CheckStatus;
  lsp: CheckStatus;
  tsc: CheckStatus;
}): LensStatusPayload {
  return {
    prettier: checkStatuses?.prettier ?? "pending",
    linters: checkStatuses?.linters ?? "pending",
    lsp: checkStatuses?.lsp ?? "pending",
    tsc: checkStatuses?.tsc ?? "pending",
  };
}

// ── Main Extension ─────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  const state: LensState = {
    config: DEFAULT_CONFIG,
    cwd: process.cwd(),
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

    const payload = buildStatusPayload(checkStatuses);
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

    // Start or connect to daemon
    await ensureDaemon(ctx.cwd);

    // Notify UI
    if (ctx.hasUI) {
      ctx.ui.notify("pi-lens: ready", "info");
    }

    publishStatus();
  });

  pi.on("session_shutdown", async () => {
    await stopDaemon(state.cwd);
    if (currentCtx?.hasUI) {
      currentCtx.ui.setStatus("pi-lens", undefined);
    }
    state.config = DEFAULT_CONFIG;
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
      const result = await runChecks(files, ctx.cwd, state.config);

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
