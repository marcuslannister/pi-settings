# Changelog

## Unreleased

- Add `npm:pi-web-search` to agent packages.
- Port the shell guards to in-process TypeScript so they run on Windows without spawning bash, and keep the self-check as a case table (`node test.ts`).
- Standardize the Pi shell guards on JSON decisions, fail closed when a guard fails, share command parsing with separator data, and add a self-check.
- Keep the pipe separator across subshell grouping, so `producer | (rg x)` is no longer blocked as a fresh command.
- Move PreToolUse guard scripts into `agent/extensions/claude-hooks-guard/` and delete `agent/hooks/`, so pi does not warn about a deprecated global hooks directory.
- Add `claude-hooks-guard` extension with standalone copies of the Claude Code PreToolUse guard scripts (git-destructive, env-dump, gh --json, modern-CLI, Anvil redirect) so Pi enforces the same AGENTS.MD rules as Claude Code.
- Stop tracking `agent/models-store.json`.
- Add the Muxy lifecycle-notification extension for Pi.
- Add the Ponytail package to Pi agent packages.
- Track `agent/mcp.json` (anvil + emacs-eval) and `agent/pi-statusline.json`.
- Add `npm:pi-mcp-adapter` to agent packages.
- Add `AGENTS.md` and `docs/agents/` config for the engineering skills: GitHub issue tracker, default triage labels, single-context domain docs.
- Track `pi` agent settings and model store; ignore `auth.json` and session logs.
