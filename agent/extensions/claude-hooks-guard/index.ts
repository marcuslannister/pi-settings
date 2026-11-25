// PreToolUse guards for the `bash` and `powershell` tools. In-process — no bash spawn. Fail closed.
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export type Decision = { blocked: boolean; reason?: string; rewriteCommand?: string };
type Parsed = { segments: string[]; separators: string[] };

const ALLOW: Decision = { blocked: false };
const deny = (reason: string): Decision => ({ blocked: true, reason });
const matches = (s: string, p: string) => new RegExp(p).test(s);
const ASK_FIRST =
  "This needs an explicit user request in the current task. Leave the work in the tree and report that it is ready.";

let toolsOverride: Set<string> | undefined;
const toolCache = new Map<string, boolean>();

// Tests pass the installed tools; undefined goes back to the PATH lookup.
export function setInstalledTools(tools: string[] | undefined) {
  toolsOverride = tools && new Set(tools);
}

// Like `command -v`: a modern tool that is not installed gets no rewrite and no deny, so the classic command runs.
// shortcut: the PATH lookup is cached for the process lifetime; a tool installed later needs a Pi restart.
function have(tool: string): boolean {
  if (toolsOverride) return toolsOverride.has(tool);
  let found = toolCache.get(tool);
  if (found === undefined) {
    const exts = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
    const runnable = (p: string) => {
      try {
        accessSync(p, constants.X_OK);
        return statSync(p).isFile();
      } catch {
        return false;
      }
    };
    found = (process.env.PATH ?? "").split(delimiter).some((dir) => dir && exts.some((e) => runnable(join(dir, tool + e))));
    toolCache.set(tool, found);
  }
  return found;
}

// A shell wrapper (`bash -c '…'`, `"C:\…\pwsh.exe" -Command '…'`): the quoted payload becomes its own command.
// The name matches without regard to case, with or without `.exe`, after a bare, unquoted, or quoted directory path.
function unwrapShell(c: string): string {
  const re = /(^|\s)(?:"(?:[^"]*[\\/])?|'(?:[^']*[\\/])?|[^\s"']*[\\/])?((?:ba|z|k|da)?sh|pwsh|powershell)(?:\.exe)?["']?((?:\s+-[A-Za-z]+)*)\s+("[^"]*"|'[^']*')/i;
  for (;;) {
    const m = c.match(re);
    if (!m) break;
    const quoted = m[4];
    const payload = quoted.slice(1, -1);
    c = c.replace(quoted, () => `; ${payload} ;`);
  }
  return c;
}

function stripQuotes(c: string): string {
  const re = /"[^"]*"|'[^']*'/;
  for (;;) {
    const m = c.match(re);
    if (!m) break;
    const span = m[0];
    let body = span.slice(1, -1);
    if (!/^[A-Za-z0-9_.:/=@$%{}+-]+$/.test(body)) {
      // A quoted executable path in command position keeps its file name: `& "C:\…\git.exe" reset --hard` is still `git`.
      const atCommand = /(^|[;&|(\n`!]|\b(?:if|then|elif|else|do|while|until|command|exec|nohup|time|env))\s*$/.test(c.slice(0, m.index));
      body = atCommand && /[\\/][^\\/\s]+$/.test(body) ? body.replace(/^.*[\\/]/, "") : " ";
    }
    c = c.replace(span, () => body);
  }
  return c;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// The command name without its directory, `.exe`, or case: `C:\Git\usr\bin\ENV.EXE` is `env`.
const commandName = (word: string) => word.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "").toLowerCase();

function normalizeSegment(s: string): string {
  let m: RegExpMatchArray | null;
  // Name the command word first, then decide whether it wraps another command (`/usr/bin/env git …`, `Command git …`).
  for (;;) {
    s = s.replace(/^(\s*)(\S+)/, (all, space, word) => (ASSIGNMENT.test(word) ? all : space + commandName(word)));
    if ((m = s.match(/^\s*(if|then|elif|else|do|while|until|!)\s+(.*)$/))) s = m[2];
    else if ((m = s.match(/^\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+(.*)$/))) s = m[1];
    else if ((m = s.match(/^\s*(command|builtin|exec|nohup|time|stdbuf|nice)(\s+-\S+)*\s+(.*)$/))) s = m[3];
    else if ((m = s.match(/^\s*env\s+(.*)$/))) {
      let t = m[1];
      while ((m = t.match(/^(-[iu]\s+\S+|--unset=\S+|-[a-zA-Z]+|[A-Za-z_][A-Za-z0-9_]*=\S*)\s+(.*)$/))) t = m[2];
      if (!t || t.startsWith("-")) break;
      s = t;
    } else break;
  }
  const trimmed = s.trim();
  if (!trimmed) return "";
  const sp = trimmed.search(/\s/);
  const first = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const rest = sp === -1 ? "" : trimmed.slice(sp).trim();
  return rest ? `${first} ${rest}` : first;
}

// Removes the body and end word of each heredoc: its lines are data, not commands. The line that opens it stays.
// A body stays when its lines can still run or print: a shell reads it (`sh`, `bash`, `ssh`, `source`, or `eval` on
// the opening line), or it is unquoted (`<<EOF`) and expands, so a line with `$` or a backtick stays.
// The scan skips quoted text, comments, and `<<<`. Like bash, it treats a heredoc with no end word as running to the end.
// shortcut: a heredoc inside `bash -c '...'` keeps its body (it may still block), and `$((a<<b))` with a letter
// operand reads as a heredoc; upgrade by calling this again after unwrapShell, and by tracking `$((`.
function stripHeredocs(c: string): string {
  if (!c.includes("<<")) return c;
  const open = /^<<(-?)\s*(['"\\]?)([A-Za-z_][^\s;&|()<>'"\\`$]*)/;
  const shell = /(^|[^\w.-])(ssh|(?:ba|z|k|da)?sh|source|eval)([^\w-]|$)/i;
  const out: string[] = [];
  const pend: { mode: "drop" | "keep" | "expand"; end: string }[] = [];
  let q = "";
  for (const line of c.split("\n")) {
    const body = pend[0];
    if (body) {
      // A CRLF command ends the heredoc at `EOF\r`. `<<-` strips tabs; stripping any blank only errs toward checking more.
      if (line.replace(/\r$/, "").trimStart() === body.end) pend.shift();
      if (body.mode === "keep" || (body.mode === "expand" && /[$`]/.test(line))) out.push(line);
      continue;
    }
    out.push(line);
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q === "'") {
        if (ch === "'") q = "";
      } else if (ch === "\\") i++;
      else if (q) {
        if (ch === '"') q = "";
      } else if (ch === "'" || ch === '"') q = ch;
      else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
      else if (ch === "<") {
        const rest = line.slice(i);
        let m: RegExpMatchArray | null;
        if (rest.startsWith("<<<")) i += 2;
        else if ((m = rest.match(open))) {
          i += m[0].length - 1;
          if ((m[2] === "'" || m[2] === '"') && line[i + 1] === m[2]) i++;
          pend.push({ mode: shell.test(line) ? "keep" : m[2] ? "drop" : "expand", end: m[3] });
        } else if (rest.startsWith("<<")) i++;
      }
    }
  }
  return out.join("\n");
}

function readCommand(command: string): Parsed {
  const c = stripQuotes(unwrapShell(stripHeredocs(command)));
  const segments: string[] = [];
  const separators: string[] = [];
  let seg = "";
  let separator = "";
  const flush = () => {
    if (seg.replace(/\s/g, "")) {
      const n = normalizeSegment(seg);
      if (n) {
        segments.push(n);
        separators.push(separator);
      }
    }
    seg = "";
  };
  for (let i = 0; i < c.length; i++) {
    const char = c[i];
    if (";&|()`\n".includes(char)) {
      flush();
      let operator = char;
      const next = c[i + 1];
      if ((char === "&" && next === "&") || (char === "|" && (next === "|" || next === "&"))) {
        operator += next;
        i++;
      }
      if (char !== "(" && char !== ")") separator = operator;
    } else {
      seg += char;
    }
  }
  flush();
  return { segments, separators };
}

const gitArgs = (s: string) => s.match(/^git(?:\s+(?:-[cC]\s+\S+|-\S+))*\s+(.*)$/)?.[1] ?? null;
const ghArgs = (s: string) => s.match(/^gh(?:\s+(?:-[Rr]\s+\S+|-\S+))*\s+(.*)$/)?.[1] ?? null;

export function blockGitDestructive(command: string, parsed: Parsed = readCommand(command)): Decision {
  for (const seg of parsed.segments) {
    const args = gitArgs(seg);
    if (!args) continue;
    if (matches(args, "^push\\b")) {
      let force = false;
      for (const tok of args.replace(/^push\b/, "").trim().split(/\s+/).filter(Boolean)) {
        if (tok === "--force" || tok === "--force-with-lease" || tok.startsWith("--force-with-lease=")) force = true;
        else if (tok.startsWith("--")) continue;
        else if (tok.startsWith("-") && tok.includes("f")) force = true;
        else if (tok.startsWith("+")) force = true;
      }
      if (force) return deny("Blocked: `git push` with a force flag or a forced refspec (`+ref`) rewrites published history.\n" + ASK_FIRST);
    }
    if (matches(args, "^reset\\b.*--hard")) return deny("Blocked: `git reset --hard`.\n" + ASK_FIRST);
    if (matches(args, "^restore\\b")) return deny("Blocked: `git restore`.\n" + ASK_FIRST);
    if (matches(args, "^filter-(branch|repo)\\b")) return deny("Blocked: `git filter-branch`/`filter-repo` rewrites published history.\n" + ASK_FIRST);
    if (matches(args, "^commit\\b.*--amend")) return deny("Blocked: `git commit --amend`. No amend unless asked.\n" + ASK_FIRST);
    if (matches(args, "^worktree\\b")) return deny("Blocked: `git worktree`. No CLI worktree unless asked.\n" + ASK_FIRST);
    if (matches(args, "^checkout\\b.*( -- |-f\\b|--force\\b)")) return deny("Blocked: `git checkout` with `--` or `--force` discards working-tree changes.\n" + ASK_FIRST);
    if (matches(args, "^rebase\\b") && !matches(args, "^rebase\\b.*--(continue|abort|skip|quit|edit-todo)")) {
      return deny("Blocked: `git rebase` can rewrite published history.\n" + ASK_FIRST);
    }
    if (matches(args, "^clean\\b") && !matches(args, "^clean\\b.*(-n\\b|--dry-run)")) {
      return deny("Blocked: `git clean`.\n" + ASK_FIRST);
    }
  }
  return ALLOW;
}

const SECRET_RE = /\$\{?[A-Za-z_]*(TOKEN|SECRET|PASSWD|PASSWORD|API_?KEY|CREDENTIAL)/;

export function blockEnvDump(command: string, parsed: Parsed = readCommand(command)): Decision {
  for (const seg of parsed.segments) {
    const sp = seg.search(/\s/);
    const cmd = sp === -1 ? seg : seg.slice(0, sp);
    const args = sp === -1 ? "" : seg.slice(sp + 1);
    if (/^(echo|printf|print|cat|tee)$/.test(cmd) && SECRET_RE.test(args)) {
      return deny("Blocked: printing a secret variable.\nNever reveal a secret value, not even an internal one. Use the approved secret tools and redact the output.");
    }
    if (/^(env|printenv|export|declare|typeset)$/.test(cmd)) {
      const words = args.trim() ? args.trim().split(/\s+/) : [];
      if (words.some((w) => !w.startsWith("-"))) continue;
    } else if (cmd === "set") {
      if (args.trim()) continue;
    } else {
      continue;
    }
    return deny(`Blocked: \`${seg}\` dumps the whole environment.\nQuery the exact variable name only, for example \`printenv MY_VAR\`, and redact the value.`);
  }
  return ALLOW;
}

export function ghJson(command: string, parsed: Parsed = readCommand(command)): Decision {
  const READ_SUB = "^(pr|issue|run|release|repo|workflow|cache|label|variable|secret) +(view|list|checks|status)\\b";
  const SEARCH = "^search +(prs|issues|repos|code|commits)\\b";
  const NO_JSON = "(^pr +diff\\b|--log\\b|--log-failed\\b)";
  for (const seg of parsed.segments) {
    const args = ghArgs(seg);
    if (!args) continue;
    if (matches(args, "^api\\b") && matches(args, "--paginate")) {
      return deny("Blocked: `gh api --paginate` bypasses the shared cache and uses the real token.\nPage manually, or ask the user before you pull the full list.");
    }
    if ((matches(args, READ_SUB) || matches(args, SEARCH)) && !matches(args, "--json") && !matches(args, NO_JSON)) {
      return deny(`Blocked: \`gh ${args.slice(0, 60)}\` reads without --json <fields>.\nHuman-format reads delegate to the real token instead of the shared cache. Add --json with the fields you need. \`gh pr diff\` and run logs are the exceptions.`);
    }
  }
  return ALLOW;
}

export function enforceModernCli(command: string, parsed: Parsed = readCommand(command)): Decision {
  if (!command) return ALLOW;
  const findRe = /^find\s+([^\s;|&]+)\s+-name\s+([^\s;|&]+)$/;
  const sedRe = /^sed\s+-i\s+'?s\/([^/\s]+)\/([^/\s]+)\/'?\s+([^\s;|&]+)$/;
  let m = have("fd") ? command.match(findRe) : null;
  if (m) return { blocked: false, rewriteCommand: `fd --glob ${m[2]} ${m[1]}` };
  m = have("sd") ? command.match(sedRe) : null;
  if (m) return { blocked: false, rewriteCommand: `sd '${m[1]}' '${m[2]}' ${m[3]}` };

  for (let i = 0; i < parsed.segments.length; i++) {
    if (parsed.separators[i] === "|" || parsed.separators[i] === "|&") continue;
    const first = parsed.segments[i].split(/\s+/)[0];
    if (first === "grep" && have("rg")) return deny('Use rg instead of grep. Example: rg -n "pattern" path');
    if (first === "ls" && have("eza")) return deny("Use eza instead of ls. Example: eza -la --git");
  }
  return ALLOW;
}

type Guard = (command: string, parsed: Parsed) => Decision;
// The `powershell` tool gets only the safety guards. Its `ls` and `find` are PowerShell commands, so no modern-CLI rewrite or deny.
const SAFETY_GUARDS: Guard[] = [blockGitDestructive, blockEnvDump];
const GUARDS = new Map<string, Guard[]>([
  ["bash", [...SAFETY_GUARDS, ghJson, enforceModernCli]],
  ["powershell", SAFETY_GUARDS],
]);

function guardCommand(command: string, guards: Guard[]): Decision {
  let rewritten: string | undefined;
  let parsed = readCommand(command);
  for (const g of guards) {
    const result = g(rewritten ?? command, parsed);
    if (result.blocked) return result;
    if (result.rewriteCommand) {
      rewritten = result.rewriteCommand;
      parsed = readCommand(rewritten);
    }
  }
  return rewritten ? { blocked: false, rewriteCommand: rewritten } : ALLOW;
}

export default function (pi) {
  pi.on("tool_call", async (event) => {
    try {
      const guards = GUARDS.get(event.toolName);
      if (guards) {
        const result = guardCommand(event.input.command, guards);
        if (result.blocked) return { block: true, reason: result.reason };
        if (result.rewriteCommand) event.input.command = result.rewriteCommand;
      }
    } catch {
      return { block: true, reason: "guard failed. Refusing to run the command." };
    }
  });
}
