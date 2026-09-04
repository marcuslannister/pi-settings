# Changelog

## Unreleased

- Add `claude-hooks-guard` extension plus `agent/hooks/` (standalone copies of the Claude Code PreToolUse guard scripts: git-destructive, env-dump, gh --json, modern-CLI, Anvil redirect) so Pi enforces the same AGENTS.MD rules as Claude Code.
- Stop tracking `agent/models-store.json`.
- Add the Muxy lifecycle-notification extension for Pi.
- Add the Ponytail package to Pi agent packages.
- Track `agent/mcp.json` (anvil + emacs-eval) and `agent/pi-statusline.json`.
- Add `npm:pi-mcp-adapter` to agent packages.
- Add `AGENTS.md` and `docs/agents/` config for the engineering skills: GitHub issue tracker, default triage labels, single-context domain docs.
- Track `pi` agent settings and model store; ignore `auth.json` and session logs.
