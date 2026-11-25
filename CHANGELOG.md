# Changelog

## Unreleased

- Stop `claude-hooks-guard` from reading a heredoc body as commands. `readCommand` first drops the body and end word of each heredoc, so `cat >> f <<'EOF'` with a body line that starts with `set`, `env`, or `export` is no longer denied as an environment dump (the same for the git, `gh`, and modern-CLI guards). A body stays checked when a shell reads it (`sh`, `bash`, `ssh`, `source`, or `eval` on the opening line), and an unquoted body keeps its lines with `$` or a backtick, because they expand.

- Rework the Pi guards after review. `claude-hooks-guard` matches command and wrapper names without regard to case, unwraps quoted executable paths (`"C:\…\pwsh.exe" -Command '…'`, `& "C:\…\git.exe" …`), and names the command word before it decides whether it wraps another command (`/usr/bin/env git …`). The `powershell` tool gets only the git-destructive and env-dump guards, with no modern-CLI deny or rewrite. Remove the Anvil redirect and its Emacs-server probe, so Pi never redirects `git status`, `git log`, `curl`, or `.org` reads to Anvil. Self-check: 199 cases.
- Make the Pi guards work on Linux and Windows (Git Bash). `claude-hooks-guard` parses `\` paths and `.exe` names like `/` and the bare name, unwraps `bash.exe`, `pwsh`, and `powershell` wrappers, guards the `powershell` tool, and rewrites or denies toward `rg`, `eza`, `fd`, and `sd` only when `have()` finds the tool. `context-handoff` prints its path with `/`. Both self-checks print `N passed, M failed`. `agent/extensions/AGENTS.md` holds the portability rule, and `.github/workflows/guards.yml` runs the self-checks on macOS, Linux, and Windows.
- Add the `context-handoff` extension: in a herdr pane (`HERDR_ENV=1`), Pi warns the agent once per session when context fill reaches 36/65 of its compaction point (`HANDOFF_PCT` overrides), so the agent hands off to a new tab before auto compact. Self-check: `node agent/extensions/context-handoff/test.ts`.
- Point `agent/AGENTS.md` at `AGENTS.codex.md` in the `home` repo (`~/Projects/home`), because Pi does not expand the `@` imports in `AGENTS.md`.
- Start compaction at 65% of the context window for the default model: `compaction.modelOverrides` sets `reserveTokens` to 367002 (35% of 1048576), because Pi has no percentage key.

- Stop tracking `agent/keybindings.json`, so image paste follows Pi's default (`ctrl+v`, or `alt+v` on Windows and WSL).
- Keep Orca agent status across session switches and extension reloads, and publish the visible subagent roster.
- Disable the built-in MCP extension and stop tracking `agent/mcp.json`.
- Finish a stuck Orca agent status turn when a subagent process exits without a completion event.
- Add Pi hooks for Orca agent status, startup prefill, and titlebar spinner.
- Recognize Windows paths as absolute in the Herdr session status extension.
- Track `agent/keybindings.json` and bind image paste to Ctrl+Shift+V (Kitty) plus Alt+V (Windows/WSL).
- Remove the Muxy, Orca, otty, and tty7 agent extensions.
- Disable `showHardwareCursor` in agent settings.
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
