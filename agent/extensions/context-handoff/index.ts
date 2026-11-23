import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TYPE = "context-handoff";
// Claude hands off at 36% with auto compact at 65%: keep that ratio of Pi's own compaction point.
const RATIO = 36 / 65;
const DEFAULT_RESERVE = 16384; // Pi's built-in compaction.reserveTokens

// Pi compacts when tokens > window - reserveTokens (compaction.md); a per-model override wins.
// HANDOFF_PCT (percent of the window, as in Claude) replaces the computed threshold.
export function warning(
  usage: { tokens: number | null; contextWindow: number } | undefined,
  compaction: any,
  model: { provider: string; id: string } | undefined,
  handoffPct: string | undefined,
): string | undefined {
  if (usage?.tokens == null || !(usage.contextWindow > 0)) return;
  const reserve =
    compaction?.modelOverrides?.[`${model?.provider}/${model?.id}`]?.reserveTokens ??
    compaction?.reserveTokens ??
    DEFAULT_RESERVE;
  const pct = Number(handoffPct);
  const limit = pct > 0 ? (usage.contextWindow * pct) / 100 : (usage.contextWindow - reserve) * RATIO;
  if (usage.tokens < limit) return;
  const fill = Math.round((usage.tokens / usage.contextWindow) * 100);
  const threshold = Math.round((limit / usage.contextWindow) * 100);
  return `Context fill is ${fill}% (handoff threshold ${threshold}%). Read ${join(homedir(), "Projects/agent-scripts/global/rules/handoff.md")} and hand off now.`;
}

// Warn once per session, in a herdr pane, before auto compact. Never blocks a turn: on error, do nothing.
export default function (pi: ExtensionAPI) {
  if (process.env.HERDR_ENV !== "1") return;
  pi.on("turn_end", (event, ctx) => {
    try {
      if (event.outcome !== "completed") return;
      const content = warning(ctx.getContextUsage(), pi.getSettings().compaction, ctx.model, process.env.HANDOFF_PCT);
      if (!content) return;
      if (ctx.sessionManager.getBranch().some((e: any) => e.type === "custom_message" && e.customType === TYPE)) return;
      return { entries: [...event.entries, { type: "custom_message", customType: TYPE, content, display: true }] };
    } catch {}
  });
}
