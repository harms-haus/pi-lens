/**
 * pi-lens — Extension entry point
 *
 * Hooks after write/edit/bash tools and automatically runs prettier,
 * linters, LSP diagnostics, and tsc on changed files via the code-lens daemon.
 */

import * as path from "node:path";
import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ensureDaemon, stopDaemon } from "@harms-haus/code-lens/client";
import { loadConfig, DEFAULT_CONFIG, loadRendererSetting } from "./config.js";
import { resolveFilesFromToolResult, runChecks } from "./hook-runner.js";
import type { CheckStatus, LensStatusPayload } from "./types.js";
import type { LensState, HookCheckStatuses } from "./hook-runner.js";
import { isRecord } from "./helpers.js";
import { renderLensDiagnostics } from "./renderer.js";
import type { LensDiagnosticDetails } from "./renderer.js";

// ── Module-level State ─────────────────────────────────────────────────

let rendererEnabled = false;

// ── Diagnostic Message Helper ───────────────────────────────────────────

function sendDiagnosticMessage(
  pi: ExtensionAPI,
  _ctx: ExtensionContext,
  result: { text: string; statuses: HookCheckStatuses; durationMs: number },
  fileCount: number,
): void {
  try {
    pi.sendMessage({
      customType: "pi-lens-diagnostics",
      content: result.text || "pi-lens: diagnostics complete",
      display: true,
      details: {
        statuses: result.statuses,
        hasIssues: result.text.includes("⚠") || result.text.includes("✗"),
        fileCount,
        durationMs: result.durationMs,
        sectionsText: result.text.includes("\n")
          ? result.text.slice(result.text.indexOf("\n") + 1)
          : undefined,
      } satisfies LensDiagnosticDetails,
    });
  } catch (e) {
    // Never fail the original tool result
    console.warn("pi-lens: failed to send diagnostic message", e);
  }
}

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

// ── Subagent Activity Detection ────────────────────────────────────────────

const SUBAGENT_CHECK_COOLDOWN_MS = 5000;

function hasToolActivity(partialResult: unknown): boolean {
  if (!isRecord(partialResult)) return false;
  const details = partialResult.details;
  if (!isRecord(details)) return false;
  const windows = details.windows;
  if (!Array.isArray(windows)) return false;
  return windows.some(
    (w: unknown) =>
      isRecord(w) &&
      Array.isArray(w.lines) &&
      (w.lines as unknown[]).some((line: unknown) => isRecord(line) && line.kind === "tool"),
  );
}

async function resolveChangedFilesFromGit(pi: ExtensionAPI, cwd: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const result = await pi.exec("git", ["diff", "--name-only", "HEAD"], {
      cwd,
      timeout: 5000,
    });
    if (result.code === 0 && result.stdout.trim()) {
      for (const line of result.stdout.trim().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) results.push(path.resolve(cwd, trimmed));
      }
    }
  } catch {
    // git may not be available or not a git repo
  }

  return [...new Set(results)].filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

// ── Subagent Check Controller ────────────────────────────────────────────

interface SubagentChecker {
  runChecksAndPublish(): Promise<void>;
  scheduleCooldownCheck(): void;
  markPending(): void;
  clear(): void;
  reset(): void;
  get lastCheckTime(): number;
  get checkInFlight(): boolean;
  get hasPendingCheck(): boolean;
}

function createSubagentChecker(
  pi: ExtensionAPI,
  state: LensState,
  publishStatus: (statuses?: {
    prettier: CheckStatus;
    linters: CheckStatus;
    lsp: CheckStatus;
    tsc: CheckStatus;
  }) => void,
  getContext: () => ExtensionContext | undefined,
): SubagentChecker {
  let lastCheckTime = 0;
  let checkInFlight = false;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let hasPendingCheck = false;
  let shutdown = false;

  async function runChecksAndPublish(): Promise<void> {
    checkInFlight = true;
    try {
      const files = await resolveChangedFilesFromGit(pi, state.cwd);
      if (shutdown) return;
      if (files.length === 0) {
        lastCheckTime = Date.now();
        if (hasPendingCheck) {
          hasPendingCheck = false;
          scheduleCooldownCheck();
        }
        return;
      }

      const result = await runChecks(files, state.cwd, state.config);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- shutdown may be set by clear() across await boundary
      if (shutdown) return;
      publishStatus(result.statuses);
      lastCheckTime = Date.now();

      if (rendererEnabled && result.text) {
        const ctx = getContext();
        if (ctx) {
          sendDiagnosticMessage(pi, ctx, result, files.length);
        }
      }

      if (hasPendingCheck) {
        hasPendingCheck = false;
        scheduleCooldownCheck();
      }
    } catch {
      if (shutdown) return;
      lastCheckTime = Date.now();
      if (hasPendingCheck) {
        hasPendingCheck = false;
        scheduleCooldownCheck();
      }
    } finally {
      checkInFlight = false;
    }
  }

  function scheduleCooldownCheck(): void {
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }

    const remaining = Math.max(0, SUBAGENT_CHECK_COOLDOWN_MS - (Date.now() - lastCheckTime));

    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      void runChecksAndPublish();
    }, remaining);
  }

  function markPending(): void {
    hasPendingCheck = true;
  }

  function clear(): void {
    shutdown = true;
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer);
      pendingTimer = undefined;
    }
    hasPendingCheck = false;
    checkInFlight = false;
    lastCheckTime = 0;
  }

  function reset(): void {
    clear();
    shutdown = false;
  }

  return {
    runChecksAndPublish,
    scheduleCooldownCheck,
    markPending,
    clear,
    reset,
    get lastCheckTime() {
      return lastCheckTime;
    },
    get checkInFlight() {
      return checkInFlight;
    },
    get hasPendingCheck() {
      return hasPendingCheck;
    },
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

  const checker = createSubagentChecker(pi, state, publishStatus, () => currentCtx);

  // ── Register Renderer ──────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- renderer type doesn't perfectly match MessageRenderer<unknown> but is functionally compatible
  pi.registerMessageRenderer("pi-lens-diagnostics", renderLensDiagnostics as any);

  // ── Session Lifecycle ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    state.cwd = ctx.cwd;
    currentCtx = ctx;
    state.config = loadConfig(ctx.cwd);
    rendererEnabled = loadRendererSetting();

    // Start or connect to daemon
    await ensureDaemon(ctx.cwd);

    // Notify UI
    if (ctx.hasUI) {
      ctx.ui.notify("pi-lens: ready", "info");
    }

    publishStatus();
    checker.reset();
  });

  pi.on("session_shutdown", async () => {
    await stopDaemon(state.cwd);
    checker.clear();
    if (currentCtx?.hasUI) {
      currentCtx.ui.setStatus("pi-lens", undefined);
    }
    state.config = DEFAULT_CONFIG;
    rendererEnabled = false;
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

      // Send diagnostic message if renderer is enabled
      if (rendererEnabled && result.text) {
        sendDiagnosticMessage(pi, ctx, result, files.length);
      }

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

  // ── Hook: tool_execution_update (subagent monitoring) ──────────────

  pi.on("tool_execution_update", (event) => {
    if (event.toolName !== "delegate_to_subagents") return undefined;
    if (!hasToolActivity(event.partialResult)) return undefined;

    const cooldownElapsed = Date.now() - checker.lastCheckTime >= SUBAGENT_CHECK_COOLDOWN_MS;

    if (!checker.checkInFlight && cooldownElapsed) {
      void checker.runChecksAndPublish();
    } else {
      checker.markPending();
      if (!checker.checkInFlight) {
        checker.scheduleCooldownCheck();
      }
    }

    return undefined;
  });

  // ── Hook: tool_execution_end (final subagent check) ────────────────

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "delegate_to_subagents") return undefined;
    void checker.runChecksAndPublish();
    return undefined;
  });
}
