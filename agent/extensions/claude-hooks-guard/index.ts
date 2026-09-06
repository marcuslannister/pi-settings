// PreToolUse Bash/Read guards, ported from Claude Code's ~/.claude/hooks so
// pi enforces the same AGENTS.MD rules (git-destructive, secrets, modern CLI,
// gh --json, Anvil redirect). These are standalone copies maintained in this
// repo (agent/extensions/claude-hooks-guard/) — not synced automatically, and
// they have since diverged: the copies here answer with a permissionDecision
// and share one parser, while ~/.claude/hooks still uses exit 2 and an inline
// splitter. Treat this directory as the current one; test-hooks.sh runs here.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));

const BASH_GUARD_SCRIPTS = [
  "block-git-destructive.sh",
  "block-env-dump.sh",
  "gh-json.sh",
  "enforce-modern-cli.sh",
  "redirect-to-anvil.sh",
];

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
  } catch {
    return { blocked: true, reason: `${script} failed. Refusing to run the command.` };
  }
}

function parseDecision(stdout: string): HookOutcome {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("missing guard decision");
  const out = JSON.parse(trimmed).hookSpecificOutput;
  if (out?.permissionDecision === "deny") {
    return { blocked: true, reason: out.permissionDecisionReason };
  }
  if (out?.permissionDecision === "allow") {
    return { blocked: false, rewriteCommand: out.updatedInput?.command };
  }
  throw new Error("invalid guard decision");
}

export default function (pi) {
  pi.on("tool_call", async (event) => {
    if (event.toolName === "bash") {
      for (const script of BASH_GUARD_SCRIPTS) {
        const result = runHook(script, { tool_name: "Bash", tool_input: { command: event.input.command } });
        if (result.blocked) return { block: true, reason: result.reason };
        if (result.rewriteCommand) event.input.command = result.rewriteCommand;
      }
    }

    if (event.toolName === "read") {
      const result = runHook("redirect-to-anvil.sh", {
        tool_name: "Read",
        tool_input: { file_path: event.input.path },
      });
      if (result.blocked) return { block: true, reason: result.reason };
    }
  });
}
