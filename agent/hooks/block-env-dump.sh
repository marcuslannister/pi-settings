#!/bin/bash
# Blocks environment dumps and printed secret values (AGENTS.MD: secrets).
# The test is whether the command names a target. `printenv NAME` and
# `declare -p NAME` are lookups; `env`, `env -0`, and `declare -x` are dumps.
source "$(dirname "$0")/lib.sh"
read_command "$(cat)"

SECRET_RE='\$\{?[A-Za-z_]*(TOKEN|SECRET|PASSWD|PASSWORD|API_?KEY|CREDENTIAL)'

deny() {
  echo "Blocked: $1" >&2
  echo "$2" >&2
  exit 2
}

for seg in "${SEGMENTS[@]}"; do
  read -r cmd args <<<"$seg"

  [[ $cmd =~ ^(echo|printf|print|cat|tee)$ && $args =~ $SECRET_RE ]] \
    && deny "printing a secret variable." \
      "Never reveal a secret value, not even an internal one. Use the approved secret tools and redact the output."

  case $cmd in
    env|printenv|export|declare|typeset)
      # An option is not a target: `-0`, `-p`, and `-x` all still dump.
      for w in $args; do [[ $w == -* ]] || continue 2; done ;;
    # `set -euo pipefail` configures the shell. Bare `set` prints everything.
    set) [[ -n $args ]] && continue ;;
    *) continue ;;
  esac

  deny "\`$seg\` dumps the whole environment." \
    "Query the exact variable name only, for example \`printenv MY_VAR\`, and redact the value."
done

exit 0
