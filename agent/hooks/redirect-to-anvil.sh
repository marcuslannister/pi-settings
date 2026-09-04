#!/usr/bin/env bash
# PreToolUse hook: redirect built-in calls to Anvil MCP equivalents
# when the Emacs daemon is reachable. No-op when Anvil is unavailable.
#
# - Bash git (read-only)     → mcp__anvil-emacs-eval__git-*
# - Bash curl (plain GET)    → mcp__anvil-emacs-eval__http-fetch / http-head
# - Read on *.org            → mcp__anvil-emacs-eval__org-read-*
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

input=$(cat)
tool=$(jq -r '.tool_name // ""' <<<"$input")

deny() {
  jq -n --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

case "$tool" in
  Bash)
    # read_command (lib.sh) normalizes each segment before Git and curl checks.
    read_command "$input"
    for seg in "${SEGMENTS[@]}"; do
      first=${seg%%[[:space:]]*}
      case "$first" in
        git)
          anvil_available || exit 0
          sub=$(awk '{print $2}' <<<"$seg")
          case "$sub" in
            status)
              deny "Use \`mcp__anvil-emacs-eval__git-status\` — structured plist with ahead/behind counts and bucketed paths."
              ;;
            log)
              deny "Use \`mcp__anvil-emacs-eval__git-log\` — returns hash/date/author/subject plists."
              ;;
            diff)
              deny "Use \`mcp__anvil-emacs-eval__git-diff-names\` (paths) or \`git-diff-stats\` (file/insert/delete counts)."
              ;;
            rev-parse)
              deny "Use \`mcp__anvil-emacs-eval__git-head-sha\` or \`git-repo-root\`."
              ;;
            branch)
              # Only redirect bare 'git branch' (read-only). Allow -d/-D/-m/-c/--set-upstream etc.
              rest=$(awk '{$1=""; $2=""; print $0}' <<<"$seg" | tr -d '[:space:]')
              if [[ -z $rest ]]; then
                deny "Use \`mcp__anvil-emacs-eval__git-branch-current\` — returns the current branch name."
              fi
              ;;
            worktree)
              sub3=$(awk '{print $3}' <<<"$seg")
              if [[ $sub3 == list ]]; then
                deny "Use \`mcp__anvil-emacs-eval__git-worktree-list\` — structured plists."
              fi
              ;;
          esac
          ;;
        curl)
          anvil_available || exit 0
          # Only a plain GET/HEAD (a URL and nothing http-fetch/http-head
          # can't express) gets redirected; anything else is left unguarded.
          has_url=0 is_head=0 unsupported=0
          for tok in ${seg#curl}; do
            case "$tok" in
              http://*|https://*) has_url=1 ;;
              -I|--head) is_head=1 ;;
              -X|--request|-d|--data*|-F|--form|-T|--upload-file|-o|--output|-O|--remote-name|-H|--header|-u|--user)
                unsupported=1 ;;
            esac
          done
          if [[ $unsupported -eq 0 && $has_url -eq 1 ]]; then
            if [[ $is_head -eq 1 ]]; then
              deny "Use \`mcp__anvil-emacs-eval__http-head\` for a HEAD request."
            else
              deny "Use \`mcp__anvil-emacs-eval__http-fetch\`."
            fi
          fi
          ;;
      esac
    done
    ;;
  Read)
    path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
    if [[ $path == *.org ]]; then
      anvil_available || exit 0
      deny "Use \`mcp__anvil-emacs-eval__org-read-outline\` (structure) or \`org-read-headline\` / \`org-read-by-id\` (subtree). 10–20× cheaper than full Read on large org files."
    fi
    ;;
esac
