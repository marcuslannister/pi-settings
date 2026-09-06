// PreToolUse Bash/Read guards. In-process — no bash spawn. Fail closed.
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";

export type Decision = { blocked: boolean; reason?: string; rewriteCommand?: string };
type Parsed = { segments: string[]; separators: string[] };
type AnvilTool = "Bash" | "Read";

const ALLOW: Decision = { blocked: false };
const deny = (reason: string): Decision => ({ blocked: true, reason });
const matches = (s: string, p: string) => new RegExp(p).test(s);
const ASK_FIRST =
  "This needs an explicit user request in the current task. Leave the work in the tree and report that it is ready.";

let anvilOverride: boolean | undefined;
let anvilCache: { value: boolean; at: number } | null = null;

export function setAnvilAvailable(value: boolean | undefined) {
  anvilOverride = value;
}

function anvilAvailable(): boolean {
  if (anvilOverride !== undefined) return anvilOverride;
  if (anvilCache && Date.now() - anvilCache.at < 60_000) return anvilCache.value;
  return false;
}

function probeEmacsListening(): Promise<boolean> {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const file = [
    process.env.XDG_RUNTIME_DIR && `${process.env.XDG_RUNTIME_DIR}/emacs/server`,
    home && `${home}/.emacs.d/server/server`,
  ].find((p): p is string => !!p && existsSync(p));
  if (!file) return Promise.resolve(false);
  let line = "";
  try {
    line = readFileSync(file, "utf8").split(/\n/, 1)[0] ?? "";
  } catch {
    return Promise.resolve(false);
  }
  const tcp = line.match(/^(\S+):(\d+)\s/);
  return new Promise((resolve) => {
    const sock = tcp ? createConnection({ host: tcp[1], port: +tcp[2] }) : createConnection(file);
    const t = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 200);
    sock.once("connect", () => {
      clearTimeout(t);
      sock.end();
      resolve(true);
    });
    sock.once("error", () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

async function refreshAnvilCache() {
  if (anvilOverride !== undefined) return;
  if (anvilCache && Date.now() - anvilCache.at < 60_000) return;
  anvilCache = { value: await probeEmacsListening(), at: Date.now() };
}

function unwrapShell(c: string): string {
  const re = /(^|\s)([^\s]*\/)?((ba|z|k|da)?sh)((\s+-[A-Za-z]+)*)\s+("[^"]*"|'[^']*')/;
  for (;;) {
    const m = c.match(re);
    if (!m) break;
    const quoted = m[7];
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
    if (!/^[A-Za-z0-9_.:/=@$%{}+-]+$/.test(body)) body = " ";
    c = c.replace(span, () => body);
  }
  return c;
}

function normalizeSegment(s: string): string {
  let m: RegExpMatchArray | null;
  while ((m = s.match(/^\s*(if|then|elif|else|do|while|until|!)\s+(.*)$/))) s = m[2];
  while ((m = s.match(/^\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+(.*)$/))) s = m[1];
  while ((m = s.match(/^\s*(command|builtin|exec|nohup|time|stdbuf|nice)(\s+-\S+)*\s+(.*)$/))) s = m[3];
  if ((m = s.match(/^\s*env\s+(.*)$/))) {
    let t = m[1];
    while ((m = t.match(/^(-[iu]\s+\S+|--unset=\S+|-[a-zA-Z]+|[A-Za-z_][A-Za-z0-9_]*=\S*)\s+(.*)$/))) t = m[2];
    if (t && !t.startsWith("-")) s = t;
  }
  const trimmed = s.trim();
  if (!trimmed) return "";
  const sp = trimmed.search(/\s/);
  const first = sp === -1 ? trimmed : trimmed.slice(0, sp);
  const rest = sp === -1 ? "" : trimmed.slice(sp).trim();
  const cmd = first.replace(/^.*\//, "");
  return rest ? `${cmd} ${rest}` : cmd;
}

function readCommand(command: string): Parsed {
  const c = stripQuotes(unwrapShell(command));
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
  let m = command.match(findRe);
  if (m) return { blocked: false, rewriteCommand: `fd --glob ${m[2]} ${m[1]}` };
  m = command.match(sedRe);
  if (m) return { blocked: false, rewriteCommand: `sd '${m[1]}' '${m[2]}' ${m[3]}` };

  for (let i = 0; i < parsed.segments.length; i++) {
    if (parsed.separators[i] === "|" || parsed.separators[i] === "|&") continue;
    const first = parsed.segments[i].split(/\s+/)[0];
    if (first === "grep") return deny('Use rg instead of grep. Example: rg -n "pattern" path');
    if (first === "ls") return deny("Use eza instead of ls. Example: eza -la --git");
  }
  return ALLOW;
}

export function redirectToAnvil(
  tool: AnvilTool,
  input: { command?: string; file_path?: string },
  parsed: Parsed = readCommand(input.command ?? ""),
): Decision {
  if (tool === "Bash") {
    for (const seg of parsed.segments) {
      const words = seg.split(/\s+/);
      const first = words[0];
      if (first === "git") {
        if (!anvilAvailable()) return ALLOW;
        const sub = words[1];
        if (sub === "status") return deny("Use `mcp__anvil-emacs-eval__git-status` — structured plist with ahead/behind counts and bucketed paths.");
        if (sub === "log") return deny("Use `mcp__anvil-emacs-eval__git-log` — returns hash/date/author/subject plists.");
        if (sub === "diff") return deny("Use `mcp__anvil-emacs-eval__git-diff-names` (paths) or `git-diff-stats` (file/insert/delete counts).");
        if (sub === "rev-parse") return deny("Use `mcp__anvil-emacs-eval__git-head-sha` or `git-repo-root`.");
        if (sub === "branch" && words.slice(2).join("") === "") {
          return deny("Use `mcp__anvil-emacs-eval__git-branch-current` — returns the current branch name.");
        }
        if (sub === "worktree" && words[2] === "list") {
          return deny("Use `mcp__anvil-emacs-eval__git-worktree-list` — structured plists.");
        }
      } else if (first === "curl") {
        if (!anvilAvailable()) return ALLOW;
        let hasUrl = false, isHead = false, unsupported = false;
        for (const tok of words.slice(1)) {
          if (/^https?:\/\//.test(tok)) hasUrl = true;
          else if (tok === "-I" || tok === "--head") isHead = true;
          else if (
            tok === "-X" || tok === "--request" || tok === "-d" || tok.startsWith("--data") ||
            tok === "-F" || tok === "--form" || tok === "-T" || tok === "--upload-file" ||
            tok === "-o" || tok === "--output" || tok === "-O" || tok === "--remote-name" ||
            tok === "-H" || tok === "--header" || tok === "-u" || tok === "--user"
          ) unsupported = true;
        }
        if (!unsupported && hasUrl) {
          return deny(isHead
            ? "Use `mcp__anvil-emacs-eval__http-head` for a HEAD request."
            : "Use `mcp__anvil-emacs-eval__http-fetch`.");
        }
      }
    }
  } else {
    const path = input.file_path ?? "";
    if (path.endsWith(".org")) {
      if (!anvilAvailable()) return ALLOW;
      return deny("Use `mcp__anvil-emacs-eval__org-read-outline` (structure) or `org-read-headline` / `org-read-by-id` (subtree). 10–20× cheaper than full Read on large org files.");
    }
  }
  return ALLOW;
}

function guardBash(command: string): Decision {
  let rewritten: string | undefined;
  let parsed = readCommand(command);
  for (const g of [blockGitDestructive, blockEnvDump, ghJson, enforceModernCli]) {
    const result = g(rewritten ?? command, parsed);
    if (result.blocked) return result;
    if (result.rewriteCommand) {
      rewritten = result.rewriteCommand;
      parsed = readCommand(rewritten);
    }
  }
  const result = redirectToAnvil("Bash", { command: rewritten ?? command }, parsed);
  if (result.blocked) return result;
  if (rewritten) return { blocked: false, rewriteCommand: rewritten };
  return ALLOW;
}

export default function (pi) {
  pi.on("tool_call", async (event) => {
    try {
      await refreshAnvilCache();
      if (event.toolName === "bash") {
        const result = guardBash(event.input.command);
        if (result.blocked) return { block: true, reason: result.reason };
        if (result.rewriteCommand) event.input.command = result.rewriteCommand;
      }
      if (event.toolName === "read") {
        const result = redirectToAnvil("Read", { file_path: event.input.path });
        if (result.blocked) return { block: true, reason: result.reason };
      }
    } catch {
      return { block: true, reason: "guard failed. Refusing to run the command." };
    }
  });
}
