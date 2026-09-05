// PreToolUse Bash/Read guards, ported from Claude Code's ~/.claude/hooks so
// pi enforces the same AGENTS.MD rules (git-destructive, secrets, modern CLI,
// gh --json, Anvil redirect). These are standalone copies maintained in this
// repo (agent/extensions/claude-hooks-guard/) — not synced automatically, so a
// change on the Claude Code side needs a manual re-copy here if it should
// apply to pi too.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));

// Exit 2 means "blocked"; stderr carries the reason (Claude Code PreToolUse convention).
const DENY_SCRIPTS = ["block-git-destructive.sh", "block-env-dump.sh", "gh-json.sh"];
// These print `{hookSpecificOutput: {permissionDecision, permissionDecisionReason?, updatedInput?}}` JSON instead.
const DECISION_SCRIPTS = ["enforce-modern-cli.sh", "redirect-to-anvil.sh"];

type HookOutcome = { blocked: boolean; reason?: string; rewriteCommand?: string };

function runHook(script: string, payload: unknown): HookOutcome {
  try {
    const stdout = execFileSync(`${HOOKS_DIR}/${script}`, [], {
      input: JSON.stringify(payload),
      timeout: 5000,
      encoding: "utf8",
      // execFileSync inherits stderr by default; pipe it so a blocked
      // command's message doesn't leak straight into pi's TUI.
      stdio: ["pipe", "pipe", "pipe"],
    });
    return parseDecision(stdout);
  } catch (err: any) {
    if (err?.status === 2) {
      const reason = String(err.stderr ?? "").trim() || `${script} blocked this command.`;
      return { blocked: true, reason };
    }
    // Missing script, timeout, non-zero from something else: fail open.
    return { blocked: false };
  }
}

function parseDecision(stdout: string): HookOutcome {
  const trimmed = stdout.trim();
  if (!trimmed) return { blocked: false };
  try {
    const out = JSON.parse(trimmed).hookSpecificOutput;
    if (out?.permissionDecision === "deny") {
      return { blocked: true, reason: out.permissionDecisionReason };
    }
    if (out?.permissionDecision === "allow" && out?.updatedInput?.command) {
      return { blocked: false, rewriteCommand: out.updatedInput.command };
    }
  } catch {
    // Not JSON: informational stdout, not a decision.
  }
  return { blocked: false };
}

export default function (pi) {
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;
      const payload = { tool_name: "Bash", tool_input: { command } };

      for (const script of DENY_SCRIPTS) {
        const result = runHook(script, payload);
        if (result.blocked) return { block: true, reason: result.reason };
      }

      for (const script of DECISION_SCRIPTS) {
        const result = runHook(script, { tool_name: "Bash", tool_input: { command: event.input.command } });
        if (result.blocked) return { block: true, reason: result.reason };
        if (result.rewriteCommand) event.input.command = result.rewriteCommand;
      }
    }

    if (isToolCallEventType("read", event)) {
      const result = runHook("redirect-to-anvil.sh", {
        tool_name: "Read",
        tool_input: { file_path: event.input.path },
      });
      if (result.blocked) return { block: true, reason: result.reason };
    }
  });
}
