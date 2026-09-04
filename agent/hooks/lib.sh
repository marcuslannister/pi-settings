#!/bin/bash
# Shared command parsing for the PreToolUse Bash hooks.
#
# read_command sets SEGMENTS: one normalised entry per command in the string.
# Each entry starts at its command word, so a hook can anchor with ^.
#
# The pipeline is: unwrap nested shells -> remove remaining quoted spans ->
# split on the shell operators -> normalise each segment.

# Replaces the quoted payload of `bash -c '...'` with a separate segment, so the
# payload is inspected as commands instead of being discarded as a string.
# Handles a leading path (/bin/sh) and any flag cluster (-lc, -e -u -c).
# Each pass removes one quote pair, so the loop always ends.
unwrap_shell() {
  local c=$1 sq="'" quoted payload
  local re='(^|[[:space:]])([^[:space:]]*/)?((ba|z|k|da)?sh)(([[:space:]]+-[A-Za-z]+)*)[[:space:]]+("[^"]*"|'"$sq"'[^'"$sq"']*'"$sq"')'
  while [[ $c =~ $re ]]; do
    quoted=${BASH_REMATCH[7]}
    payload=${quoted:1:${#quoted}-2}
    c=${c/"$quoted"/"; $payload ;"}
  done
  printf '%s' "$c"
}

# Removes quote syntax. A span holding one plain token keeps its text, because
# `git 'push'` still runs push. A span holding a space or a shell metacharacter
# is data and goes away, so rg -i "cli|env|gh" cannot read as a bare `env`.
# Runs after unwrap_shell, so a real nested command has already been taken out.
strip_quotes() {
  local c=$1 sq="'" span body
  while [[ $c =~ (\"[^\"]*\"|$sq[^$sq]*$sq) ]]; do
    span=${BASH_REMATCH[1]}
    body=${span:1:${#span}-2}
    [[ $body =~ ^[A-Za-z0-9_.:/=@$%{}+-]+$ ]] || body=" "
    c=${c/"$span"/"$body"}
  done
  printf '%s' "$c"
}

# Strips what hides a command word: a shell keyword (`if ls`), an environment
# assignment (`FOO=1 git`), and a leading path (`/usr/bin/git`).
normalize_segment() {
  local s=$1 first rest
  while [[ $s =~ ^[[:space:]]*(if|then|elif|else|do|while|until|!)[[:space:]]+(.*)$ ]]; do
    s=${BASH_REMATCH[2]}
  done
  while [[ $s =~ ^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+(.*)$ ]]; do
    s=${BASH_REMATCH[1]}
  done
  # These run the next word as the command, so they must not hide it.
  while [[ $s =~ ^[[:space:]]*(command|builtin|exec|nohup|time|stdbuf|nice)([[:space:]]+-[^[:space:]]+)*[[:space:]]+(.*)$ ]]; do
    s=${BASH_REMATCH[3]}
  done
  # `env` is transparent only when a command follows its options. `env -0` and
  # bare `env` keep their name, so block-env-dump still sees the dump.
  if [[ $s =~ ^[[:space:]]*env[[:space:]]+(.*)$ ]]; then
    local t=${BASH_REMATCH[1]}
    while [[ $t =~ ^(-[iu][[:space:]]+[^[:space:]]+|--unset=[^[:space:]]+|-[a-zA-Z]+|[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)[[:space:]]+(.*)$ ]]; do
      t=${BASH_REMATCH[2]}
    done
    [[ -n $t && $t != -* ]] && s=$t
  fi
  # `read` trims both ends and splits off the first word.
  read -r first rest <<<"$s"
  printf '%s' "${first##*/}${rest:+ $rest}"
}

# Cached Anvil probe (60s TTL) — avoids spawning emacsclient on every hook fire.
# Returns 0 if the Emacs daemon answers, 1 otherwise. Shared by any hook that
# needs to know whether an Anvil MCP redirect is available before it fires.
# ANVIL_PROBE_CACHE overrides the cache path (tests use an isolated file so
# they never race the real probe a concurrent Claude Code session relies on).
anvil_available() {
  local cache="${ANVIL_PROBE_CACHE:-/tmp/.anvil-probe-${UID:-$(id -u)}}"
  if [[ -f $cache ]]; then
    local mtime now
    mtime=$(/usr/bin/stat -f %m "$cache" 2>/dev/null || /usr/bin/stat -c %Y "$cache" 2>/dev/null || echo 0)
    now=$(date +%s)
    if (( now - mtime < 60 )); then
      [[ $(cat "$cache") == ok ]]
      return
    fi
  fi
  # --timeout bounds a stuck-but-listening daemon; without it a blocked
  # socket hangs the probe (and every hook waiting on it) indefinitely.
  if command -v emacsclient >/dev/null 2>&1 && emacsclient --timeout=2 -e t >/dev/null 2>&1; then
    echo ok > "$cache"; return 0
  fi
  echo no > "$cache"; return 1
}

read_command() {
  local c seg
  c=$(strip_quotes "$(unwrap_shell "$(jq -r '.tool_input.command // empty' <<<"$1")")")
  SEGMENTS=()
  while IFS= read -r seg; do
    seg=$(normalize_segment "$seg")
    [ -n "$seg" ] && SEGMENTS+=("$seg")
  done < <(printf '%s\n' "$c" | tr ';&|()`' '\n\n\n\n\n\n')
}
