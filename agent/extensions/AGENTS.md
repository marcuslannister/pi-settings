# Extension portability
- Pi runs these on macOS, Linux, and Windows (Git Bash for the `bash` tool). Run `node agent/extensions/claude-hooks-guard/test.ts` and `node agent/extensions/context-handoff/test.ts` before you commit; CI runs both on all three. Reason: a guard that passes on one system can fail open on another.
- Check a tool with `have()` before a rewrite or deny toward `rg`, `eza`, `fd`, or `sd`. Reason: some machines lack them, and the agent then gets `command not found`.
- Match command names without regard to case, parse `\` like `/` and `.exe` like the bare name, and print paths to the agent with `/`. Reason: `Git.EXE reset --hard` passed the guard, and a `\` path breaks in Git Bash.
- Run the safety guards (git destructive, env dump) on every tool that runs a command (`bash` and `powershell`); apply modern-CLI rewrites to `bash` only. Reason: an unguarded tool is a bypass, and PowerShell `ls` and `find` are not the Unix tools.
