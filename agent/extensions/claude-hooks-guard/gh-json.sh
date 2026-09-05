#!/bin/bash
# Enforces the `gh` read rules (rules/github.md): every read passes --json, and
# --paginate bypasses the shared cache. Each `gh` command is judged on its own,
# so one --json cannot excuse a human-format read beside it.
source "$(dirname "$0")/lib.sh"
read_command "$(cat)"

# Read subcommands, by their own verb set.
READ_SUBCOMMAND_RE='^(pr|issue|run|release|repo|workflow|cache|label|variable|secret) +(view|list|checks|status)\b'
SEARCH_RE='^search +(prs|issues|repos|code|commits)\b'
# These have no JSON form: `gh pr diff`, and any run log.
NO_JSON_FORM='(^pr +diff\b|--log\b|--log-failed\b)'

for seg in "${SEGMENTS[@]}"; do
  [[ $seg =~ ^gh([[:space:]]+(-[Rr][[:space:]]+[^[:space:]]+|-[^[:space:]]+))*[[:space:]]+(.*)$ ]] || continue
  args=${BASH_REMATCH[3]}
  arg() { grep -qE -- "$1" <<<"$args"; }

  if arg '^api\b' && arg '--paginate'; then
    echo "Blocked: \`gh api --paginate\` bypasses the shared cache and uses the real token." >&2
    echo "Page manually, or ask the user before you pull the full list." >&2
    exit 2
  fi

  if { arg "$READ_SUBCOMMAND_RE" || arg "$SEARCH_RE"; } \
    && ! arg '--json' && ! arg "$NO_JSON_FORM"; then
    echo "Blocked: \`gh ${args:0:60}\` reads without --json <fields>." >&2
    echo "Human-format reads delegate to the real token instead of the shared cache. Add --json with the fields you need. \`gh pr diff\` and run logs are the exceptions." >&2
    exit 2
  fi
done

exit 0
