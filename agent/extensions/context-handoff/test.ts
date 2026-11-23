// Self-check, same cases as the context-handoff cases in claude-code-settings test-hooks.sh. `node test.ts`
import install, { warning } from "./index.ts";

let fail = 0;
function check(name: string, ok: boolean) {
  if (!ok) {
    console.log(`FAIL context-handoff: ${name}`);
    fail++;
  }
}

const M = { provider: "p", id: "m" };
const tail = "agent-scripts/global/rules/handoff.md and hand off now.";

// Threshold: 36/65 of the compaction point. Default reserve 16384 on a 200000 window: 183616 * 36/65 = 101695.01.
check("below default threshold", warning({ tokens: 101695, contextWindow: 200000 }, undefined, M, undefined) === undefined);
const w = warning({ tokens: 101696, contextWindow: 200000 }, undefined, M, undefined) ?? "";
check("at default threshold", w.startsWith("Context fill is 51% (handoff threshold 51%). Read ") && w.endsWith(tail));

// The per-model reserve gives 65% compaction on 1048576, so 36% handoff.
const over = { modelOverrides: { "p/m": { reserveTokens: 367002 } } };
check("override below", warning({ tokens: 377487, contextWindow: 1048576 }, over, M, undefined) === undefined);
check("override at", /^Context fill is 36% \(handoff threshold 36%\)/.test(warning({ tokens: 377488, contextWindow: 1048576 }, over, M, undefined) ?? ""));
check("override of another model is ignored", warning({ tokens: 377488, contextWindow: 1048576 }, over, { provider: "p", id: "x" }, undefined) === undefined);
check("ordinary reserveTokens", warning({ tokens: 40, contextWindow: 100 }, { reserveTokens: 10 }, M, undefined) === undefined);

// HANDOFF_PCT overrides; a bad value falls back to the computed threshold.
check("HANDOFF_PCT fires", /threshold 10%/.test(warning({ tokens: 10, contextWindow: 100 }, undefined, M, "10") ?? ""));
check("HANDOFF_PCT holds", warning({ tokens: 9, contextWindow: 100 }, undefined, M, "10") === undefined);
check("HANDOFF_PCT bad value", warning({ tokens: 9, contextWindow: 200000 }, undefined, M, "abc") === undefined);

// Unknown fill (right after compaction) or no window: nothing.
check("tokens null", warning({ tokens: null, contextWindow: 100 }, undefined, M, "1") === undefined);
check("no usage", warning(undefined, undefined, M, "1") === undefined);

// Wiring: only in a herdr pane, once per session, never throws.
type Handler = (event: any, ctx: any) => any;
function load(env: string | undefined) {
  let h: Handler | undefined;
  if (env === undefined) delete process.env.HERDR_ENV;
  else process.env.HERDR_ENV = env;
  install({ on: (_n: string, fn: Handler) => (h = fn), getSettings: () => ({}) } as any);
  return h;
}
const ctx = (branch: any[]) => ({
  getContextUsage: () => ({ tokens: 150000, contextWindow: 200000, percent: 75 }),
  model: M,
  sessionManager: { getBranch: () => branch },
});
const ev = (outcome = "completed") => ({ outcome, entries: [{ type: "custom", customType: "other" }] });

check("no handler without HERDR_ENV", load(undefined) === undefined);
check("no handler when HERDR_ENV=0", load("0") === undefined);
const h = load("1")!;
const out = h(ev(), ctx([]));
check("warns with the draft entries kept", out?.entries?.length === 2 && out.entries[1].type === "custom_message" && out.entries[1].customType === "context-handoff" && out.entries[1].content.includes("hand off now"));
check("once per session", h(ev(), ctx([out.entries[1]])) === undefined);
check("not on an aborted turn", h(ev("aborted"), ctx([])) === undefined);
check("error does nothing", h(ev(), { getContextUsage: () => { throw new Error("boom"); } }) === undefined);

if (fail === 0) console.log("all context-handoff checks passed");
else process.exit(1);
