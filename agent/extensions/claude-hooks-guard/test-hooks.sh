#!/bin/bash
# Self-check: feeds each hook a command and asserts the outcome.
# Every hook answers with a permissionDecision on stdout. Silence is a failure,
# not an allow: index.ts blocks when a guard produces no decision, so a hook
# that crashes must not read as "safe" here either.
cd "$(dirname "$0")" || exit 1
MODERN=./enforce-modern-cli.sh
fail=0

payload() { printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')"; }

# Prints the hook's decision, or `none` when it stayed silent or emitted junk.
verdict() { jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null <<<"$1" || echo none; }

check() { # check <script> <expected: allow|deny> <command>
  actual=$(verdict "$(payload "$3" | "./$1" 2>/dev/null)")
  if [ "$actual" != "$2" ]; then
    echo "FAIL $1: expected $2, got $actual for: $3"
    fail=1
  fi
}

decision() { # decision <expected: allow|deny> <command>
  actual=$(verdict "$(payload "$2" | "$MODERN" 2>/dev/null)")
  if [ "$actual" != "$1" ]; then
    echo "FAIL enforce-modern-cli.sh: expected $1, got $actual for: $2"
    fail=1
  fi
}

rewrite() { # rewrite <expected-command> <command>
  out=$(payload "$2" | "$MODERN" 2>/dev/null)
  actual=$(jq -r '.hookSpecificOutput.updatedInput.command // empty' <<<"$out")
  if [ "$actual" != "$1" ]; then
    echo "FAIL enforce-modern-cli.sh: expected rewrite $1, got $actual for: $2"
    fail=1
  fi
}

# A plain `git push` is intentionally allowed: a hook cannot tell an
# authorised ship from an unprompted one. CLAUDE.md governs plain pushes.
# `--force` rewrites published history regardless, so it stays blocked.
check block-git-destructive.sh allow 'git push origin main'
check block-git-destructive.sh deny 'git -C ./repo push --force'
check block-git-destructive.sh deny 'git push -f origin main'
check block-git-destructive.sh deny 'git push --force-with-lease origin main'
# Bundled short flags and forced refspecs also force.
check block-git-destructive.sh deny 'git push -fu origin main'
check block-git-destructive.sh deny 'git push -uf origin main'
check block-git-destructive.sh deny 'git push origin +main'
# A branch/refspec that merely ends in `-f`, or a lease-adjacent option that
# does not by itself force, must not false-positive.
check block-git-destructive.sh allow 'git push origin feature-f'
check block-git-destructive.sh allow 'git push --force-if-includes origin main'
check block-git-destructive.sh deny 'git reset --hard HEAD~1'
check block-git-destructive.sh deny 'git commit -m x --amend'
check block-git-destructive.sh deny 'git rebase main'
check block-git-destructive.sh deny 'git clean -fd'
check block-git-destructive.sh allow 'git status -sb'
check block-git-destructive.sh allow 'git commit -m "fix: no push here"'
# Finishing an authorised rebase, and previewing a clean, are not destructive.
check block-git-destructive.sh allow 'git rebase --continue'
check block-git-destructive.sh allow 'git clean -n'
# `git checkout -- <path>` discards working-tree changes; a branch checkout does not.
check block-git-destructive.sh deny 'git checkout -- .'
check block-git-destructive.sh deny 'git checkout -f main'
check block-git-destructive.sh allow 'git checkout -b feature/x'
check block-git-destructive.sh allow 'git checkout main'
# Prefixes that used to hide the command word.
check block-git-destructive.sh deny '/usr/bin/git clean -fd'
check block-git-destructive.sh deny 'FOO=1 git clean -fd'
check block-git-destructive.sh deny 'if git clean -fd; then echo x; fi'

# A nested shell payload is inspected, not discarded as a string.
check block-git-destructive.sh deny "bash -lc 'git restore .'"
check block-git-destructive.sh deny 'bash -c "git clean -fd"'
check block-git-destructive.sh deny "/bin/sh -c 'git reset --hard'"
check block-git-destructive.sh allow "bash -lc 'git status -sb'"
# An exempt command beside a destructive one does not excuse it.
check block-git-destructive.sh deny 'git clean -fd; git clean -n'
check block-git-destructive.sh deny 'git rebase main; git rebase --continue'
check block-git-destructive.sh deny 'git status && git clean -fd'
check block-git-destructive.sh allow 'git clean -n; git rebase --continue'

# A quoted token still runs: `git 'clean'` is a clean.
check block-git-destructive.sh deny "git 'clean' -fd"
check block-git-destructive.sh deny 'git "reset" --hard'
# Transparent prefixes run the next word as the command.
check block-git-destructive.sh deny 'command git clean -fd'
check block-git-destructive.sh deny 'exec git clean -fd'
check block-git-destructive.sh deny 'env -u GIT_DIR git clean -fd'
check block-git-destructive.sh allow 'env -u GIT_DIR git status'

check block-env-dump.sh deny 'env'
check block-env-dump.sh deny 'env | rg TOKEN'
check block-env-dump.sh deny 'export -p'
check block-env-dump.sh deny 'printenv'
check block-env-dump.sh allow 'printenv GITHUB_TOKEN'
check block-env-dump.sh allow 'env -u GITHUB_TOKEN gh pr create --body-file ./b'
check block-env-dump.sh allow 'set -euo pipefail'
check block-env-dump.sh allow 'git reset --soft HEAD~1'
# A quoted alternation is text, not a command word.
check block-env-dump.sh allow 'rg -i "cli|env|gh" hooks/'
check block-env-dump.sh deny 'declare -x'
check block-env-dump.sh deny 'typeset -p'
check block-env-dump.sh deny '/usr/bin/env'
# A printed secret value, quoted or not.
check block-env-dump.sh deny 'echo $GITHUB_TOKEN'
check block-env-dump.sh deny 'echo "$ANTHROPIC_API_KEY"'
check block-env-dump.sh deny 'printf "%s" "${MY_SECRET}"'
check block-env-dump.sh allow 'echo $HOME'
check block-env-dump.sh allow 'gh auth status'
check block-env-dump.sh deny "sh -c 'env'"
check block-env-dump.sh deny 'printenv; echo done'
check block-env-dump.sh deny "'env'"
# An option is not a target, so these still dump.
check block-env-dump.sh deny 'env -0'
check block-env-dump.sh deny 'printenv -0'
check block-env-dump.sh deny 'export'
check block-env-dump.sh deny 'declare'
# A named target is a lookup, not a dump.
check block-env-dump.sh allow 'declare -p FOO'
check block-env-dump.sh allow 'export FOO=1'
check block-env-dump.sh allow 'set -x'
# A secret print inside shell control flow.
check block-env-dump.sh deny 'if echo $GITHUB_TOKEN; then :; fi'
check block-env-dump.sh deny 'echo "${GH_TOKEN}"'

# Isolate the Anvil probe cache from the real one (/tmp/.anvil-probe-$UID) so
# these checks never race a live Claude Code session's redirect decisions,
# and clean up via trap so an interrupted run can't leave stale state behind.
export ANVIL_PROBE_CACHE
ANVIL_PROBE_CACHE=$(mktemp "${TMPDIR:-/tmp}/anvil-probe-test.XXXXXX")
trap 'rm -f "$ANVIL_PROBE_CACHE"' EXIT

# The modern-CLI hook now owns exact `find` and `sed -i` rewrites.
echo no > "$ANVIL_PROBE_CACHE"

decision deny  'grep -r foo .'
decision deny  'ls'
rewrite 'fd --glob x .' 'find . -name x'
rewrite "fd --glob '*.ts' src" "find src -name '*.ts'"
decision allow 'find . -maxdepth 3'
decision allow 'find . -inum 42'
decision allow 'find . -exec rm {} ;'
rewrite "sd 'a' 'b' f" 'sed -i s/a/b/ f'
rewrite "sd 'a' 'b' f" "sed -i 's/a/b/' f"
decision allow 'sed -i s/a/b/g f'
decision allow 'git grep foo'
decision allow 'rg foo'
# Downstream pipeline use stays allowed, including the stderr-carrying pipe.
decision allow 'ps aux | grep claude'
decision allow 'cat f | sed s/a/b/'
decision allow 'cat f |& grep x'
# Grouping punctuation must not swallow the pipe that precedes it, and must
# not manufacture an exemption where the preceding operator was not a pipe.
decision allow 'ps aux | (grep x)'
decision deny  'true; (grep foo f)'
decision deny  '(ls)'
decision deny  'ps aux | (true; grep x)'
# `||` and `&&` start a fresh command, so they are not a pipeline exemption.
decision deny  'true || grep foo f'
decision deny  'true && grep foo f'
# Sharing lib.sh closed what the old inline splitter missed: a nested shell
# payload and the transparent `command`/`env` prefixes.
decision deny  "bash -c 'ls -la'"
decision deny  'command ls'
decision deny  'env ls'
# The old script also strips env assignments and leading paths.
decision deny  'FOO=1 ls'
decision deny  '/bin/ls -la'
# A leading shell keyword must not hide the command word.
decision deny  'if ls; then echo x; fi'
decision deny  'while ls; do :; done'
decision deny  '! grep foo f'
decision deny  'if FOO=1 /bin/ls; then :; fi'
decision allow 'if rg foo; then echo x; fi'

check gh-json.sh deny 'gh pr view 12'
check gh-json.sh deny 'gh -R o/r issue list'
check gh-json.sh deny 'gh api --paginate repos/o/r/issues'
check gh-json.sh allow 'gh pr view 12 --json title,state'
check gh-json.sh allow 'gh pr diff 12'
check gh-json.sh allow 'rg "gh pr view" docs/'
check gh-json.sh deny 'gh release list'
check gh-json.sh deny 'gh search prs --state open'
check gh-json.sh allow 'gh search prs --state open --json number,title'
# A run log has no JSON form, like `gh pr diff`.
check gh-json.sh allow 'gh run view 123 --log'
check gh-json.sh allow 'gh run view 123 --log-failed'
check gh-json.sh allow 'gh pr create --body-file ./b'
# Each gh read is judged on its own.
check gh-json.sh deny 'gh pr view 1; gh pr view 2 --json title'
check gh-json.sh deny 'gh run view 1 --log; gh pr view 2'
check gh-json.sh allow 'gh pr view 1 --json title; gh run view 2 --log'
check gh-json.sh deny "gh pr 'view' 1"
check gh-json.sh deny 'env gh pr view 1'
# Other JSON-capable read families.
check gh-json.sh deny 'gh label list'
check gh-json.sh deny 'gh variable list'
check gh-json.sh deny 'gh secret list'
check gh-json.sh allow 'gh label list --json name'

# Flip the isolated probe cache to 'ok' for the Anvil checks.
REDIRECT=./redirect-to-anvil.sh
echo ok > "$ANVIL_PROBE_CACHE"

redirect_decision() { # redirect_decision <expected: allow|deny> <tool_name> <tool_input-json>
  actual=$(verdict "$(printf '{"tool_name":"%s","tool_input":%s}' "$2" "$3" | "$REDIRECT" 2>/dev/null)")
  if [ "$actual" != "$1" ]; then
    echo "FAIL redirect-to-anvil.sh: expected $1, got $actual for: $2 $3"
    fail=1
  fi
}

redirect_decision deny  Bash '{"command":"git status"}'
redirect_decision allow Bash '{"command":"git push origin main"}'
redirect_decision deny  Bash '{"command":"curl https://example.com"}'
redirect_decision deny  Bash '{"command":"curl -I https://example.com"}'
redirect_decision allow Bash '{"command":"curl -X POST https://example.com -d foo"}'
# Flags placed after the URL must still be scanned, not just token 2.
redirect_decision allow Bash '{"command":"curl https://example.com --head -o out.html"}'
redirect_decision allow Bash '{"command":"curl https://example.com -X POST -d foo"}'
redirect_decision allow Bash '{"command":"sed -i s/a/b/ f.txt"}'
redirect_decision allow Bash '{"command":"sed -n 1,5p f.txt"}'
redirect_decision deny  Read '{"file_path":"./x.org"}'
redirect_decision allow Read '{"file_path":"./x.md"}'
redirect_decision allow Bash '{"command":"echo ok; sed -i s/a/b/ f.txt"}'
redirect_decision allow Bash '{"command":"FOO=1 sed -i s/a/b/ f.txt"}'
redirect_decision allow Bash '{"command":"/usr/bin/sed -i s/a/b/ f.txt"}'

[ "$fail" = 0 ] && echo "all hook checks passed"
exit "$fail"
