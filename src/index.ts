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
import { type CheckStatuses } from "./types.js";
import type { LensStatusPayload } from "./types.js";
import type { LensState } from "./hook-runner.js";
import { isRecord } from "./helpers.js";
import { renderLensDiagnostics } from "./renderer.js";
import type { LensDiagnosticDetails } from "./renderer.js";

// ── Module-level State ─────────────────────────────────────────────────

let rendererEnabled = false;

// ── Diagnostic Message Helper ───────────────────────────────────────────

function sendDiagnosticMessage(
  pi: ExtensionAPI,
  _ctx: ExtensionContext,
  result: { text: string; statuses: CheckStatuses; durationMs: number },
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

function buildStatusPayload(checkStatuses?: CheckStatuses): LensStatusPayload {
  return {
    prettier: checkStatuses?.prettier ?? "pending",
    linters: checkStatuses?.linters ?? "pending",
    lsp: checkStatuses?.lsp ?? "pending",
    tsc: checkStatuses?.tsc ?? "pending",
  };
}

// ── Subagent Activity Detection ────────────────────────────────────────────

const SUBAGENT_CHECK_COOLDOWN_MS = 5000;

function hasFileModifyingToolActivity(partialResult: unknown): boolean {
  if (!isRecord(partialResult)) return false;
  const details = partialResult.details;
  if (!isRecord(details)) return false;
  const windows = details.windows;
  if (!Array.isArray(windows)) return false;
  return windows.some(
    (w: unknown) =>
      isRecord(w) &&
      Array.isArray(w.lines) &&
      (w.lines as unknown[]).some((line: unknown) => {
        if (!isRecord(line) || line.kind !== "tool") return false;
        if (typeof line.content !== "string") return false;
        const toolName = line.content.split(/\s+/)[0];
        return toolName === "write" || toolName === "edit" || toolName === "bash";
      }),
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

interface CheckerState {
  lastCheckTime: number;
  checkInFlight: boolean;
  pendingTimer: ReturnType<typeof setTimeout> | undefined;
  hasPendingCheck: boolean;
  hadFileModifyingActivity: boolean;
  shutdown: boolean;
  previousFiles: Set<string>;
}

interface SubagentChecker {
  runChecksAndPublish(): Promise<void>;
  runFinalCheckAndPublish(): Promise<void>;
  scheduleCooldownCheck(): void;
  markPending(): void;
  markFileActivity(): void;
  registerCheckedFiles(files: string[]): void;
  clear(): void;
  reset(): void;
  get lastCheckTime(): number;
  get checkInFlight(): boolean;
  get hasPendingCheck(): boolean;
  get hadFileModifyingActivity(): boolean;
}

async function executeCheck(
  cs: CheckerState,
  pi: ExtensionAPI,
  state: LensState,
  publishStatus: (...a: Parameters<typeof buildStatusPayload>) => void,
  getContext: () => ExtensionContext | undefined,
  scheduleCooldownCheck: () => void,
): Promise<void> {
  cs.checkInFlight = true;
  try {
    const files = await resolveChangedFilesFromGit(pi, state.cwd);
    if (cs.shutdown) return;
    const newFiles = files.filter((f) => !cs.previousFiles.has(f));
    for (const f of files) cs.previousFiles.add(f);
    if (newFiles.length === 0) {
      cs.lastCheckTime = Date.now();
      if (cs.hasPendingCheck) {
        cs.hasPendingCheck = false;
        scheduleCooldownCheck();
      }
      return;
    }
    const result = await runChecks(newFiles, state.cwd, state.config);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (cs.shutdown) return;
    publishStatus(result.statuses);
    cs.lastCheckTime = Date.now();
    if (rendererEnabled && result.text) {
      const ctx = getContext();
      if (ctx) sendDiagnosticMessage(pi, ctx, result, newFiles.length);
    }
    if (cs.hasPendingCheck) {
      cs.hasPendingCheck = false;
      scheduleCooldownCheck();
    }
  } catch {
    if (cs.shutdown) return;
    cs.lastCheckTime = Date.now();
    if (cs.hasPendingCheck) {
      cs.hasPendingCheck = false;
      scheduleCooldownCheck();
    }
  } finally {
    cs.checkInFlight = false;
  }
}

function createSubagentChecker(
  pi: ExtensionAPI,
  state: LensState,
  publishStatus: (statuses?: CheckStatuses) => void,
  getContext: () => ExtensionContext | undefined,
): SubagentChecker {
  const cs: CheckerState = {
    lastCheckTime: 0,
    checkInFlight: false,
    pendingTimer: undefined,
    hasPendingCheck: false,
    hadFileModifyingActivity: false,
    shutdown: false,
    previousFiles: new Set(),
  };

  function scheduleCooldownCheck(): void {
    if (cs.pendingTimer !== undefined) {
      clearTimeout(cs.pendingTimer);
      cs.pendingTimer = undefined;
    }
    const remaining = Math.max(0, SUBAGENT_CHECK_COOLDOWN_MS - (Date.now() - cs.lastCheckTime));
    cs.pendingTimer = setTimeout(() => {
      cs.pendingTimer = undefined;
      void runChecksAndPublish();
    }, remaining);
  }

  function runChecksAndPublish(): Promise<void> {
    return executeCheck(cs, pi, state, publishStatus, getContext, scheduleCooldownCheck);
  }

  function runFinalCheckAndPublish(): Promise<void> {
    cs.previousFiles = new Set();
    if (cs.checkInFlight) {
      cs.hasPendingCheck = true;
      scheduleCooldownCheck();
      return Promise.resolve();
    }
    return runChecksAndPublish();
  }

  return {
    runChecksAndPublish,
    runFinalCheckAndPublish,
    scheduleCooldownCheck,
    markPending() {
      cs.hasPendingCheck = true;
    },
    markFileActivity() {
      cs.hadFileModifyingActivity = true;
    },
    registerCheckedFiles(files: string[]) {
      for (const f of files) cs.previousFiles.add(f);
    },
    clear() {
      cs.shutdown = true;
      if (cs.pendingTimer !== undefined) {
        clearTimeout(cs.pendingTimer);
        cs.pendingTimer = undefined;
      }
      cs.hasPendingCheck = false;
      cs.checkInFlight = false;
      cs.hadFileModifyingActivity = false;
      cs.lastCheckTime = 0;
      cs.previousFiles = new Set();
    },
    reset() {
      this.clear();
      cs.shutdown = false;
    },
    get lastCheckTime() {
      return cs.lastCheckTime;
    },
    get checkInFlight() {
      return cs.checkInFlight;
    },
    get hasPendingCheck() {
      return cs.hasPendingCheck;
    },
    get hadFileModifyingActivity() {
      return cs.hadFileModifyingActivity;
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

  function publishStatus(checkStatuses?: CheckStatuses): void {
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

      // Register checked files so the subagent checker skips them
      checker.registerCheckedFiles(files);

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
    if (!hasFileModifyingToolActivity(event.partialResult)) return undefined;

    checker.markFileActivity();

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
    if (checker.hadFileModifyingActivity) {
      void checker.runFinalCheckAndPublish();
    }
    return undefined;
  });
}
