// Self-check: same fixtures as the old test-hooks.sh. `node test.ts`
import install, {
  blockEnvDump,
  blockGitDestructive,
  enforceModernCli,
  ghJson,
  setInstalledTools,
  type Decision,
} from "./index.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fail = 0;
let total = 0;

function verdict(d: Decision): "allow" | "deny" {
  return d.blocked ? "deny" : "allow";
}

function check(fn: (c: string) => Decision, expected: "allow" | "deny", command: string) {
  total++;
  const actual = verdict(fn(command));
  if (actual !== expected) {
    console.log(`FAIL: expected ${expected}, got ${actual} for: ${command}`);
    fail++;
  }
}

function decision(expected: "allow" | "deny", command: string) {
  total++;
  const d = enforceModernCli(command);
  const actual = verdict(d);
  if (actual !== expected) {
    console.log(`FAIL enforce-modern-cli: expected ${expected}, got ${actual} for: ${command}`);
    fail++;
  }
}

function rewrite(expected: string, command: string) {
  total++;
  const actual = enforceModernCli(command).rewriteCommand ?? "";
  if (actual !== expected) {
    console.log(`FAIL enforce-modern-cli: expected rewrite ${expected}, got ${actual} for: ${command}`);
    fail++;
  }
}

// The cases below do not depend on this machine: pretend all four modern tools are installed.
setInstalledTools(["rg", "eza", "fd", "sd"]);

const git = (e: "allow" | "deny", c: string) => check(blockGitDestructive, e, c);
const env = (e: "allow" | "deny", c: string) => check(blockEnvDump, e, c);
const gh = (e: "allow" | "deny", c: string) => check(ghJson, e, c);

git("allow", "git push origin main");
git("deny", "git -C ./repo push --force");
git("deny", "git push -f origin main");
git("deny", "git push --force-with-lease origin main");
git("deny", "git push -fu origin main");
git("deny", "git push -uf origin main");
git("deny", "git push origin +main");
git("allow", "git push origin feature-f");
git("allow", "git push --force-if-includes origin main");
git("deny", "git reset --hard HEAD~1");
git("deny", "git commit -m x --amend");
git("deny", "git rebase main");
git("deny", "git clean -fd");
git("allow", "git status -sb");
git("allow", 'git commit -m "fix: no push here"');
git("allow", "git rebase --continue");
git("allow", "git clean -n");
git("deny", "git checkout -- .");
git("deny", "git checkout -f main");
git("allow", "git checkout -b feature/x");
git("allow", "git checkout main");
git("deny", "/usr/bin/git clean -fd");
git("deny", "FOO=1 git clean -fd");
git("deny", "if git clean -fd; then echo x; fi");
git("deny", "bash -lc 'git restore .'");
git("deny", 'bash -c "git clean -fd"');
git("deny", "/bin/sh -c 'git reset --hard'");
git("allow", "bash -lc 'git status -sb'");
git("deny", "git clean -fd; git clean -n");
git("deny", "git rebase main; git rebase --continue");
git("deny", "git status && git clean -fd");
git("allow", "git clean -n; git rebase --continue");
git("deny", "git 'clean' -fd");
git("deny", 'git "reset" --hard');
git("deny", "command git clean -fd");
git("deny", "exec git clean -fd");
git("deny", "env -u GIT_DIR git clean -fd");
git("allow", "env -u GIT_DIR git status");
git("deny", "git.exe reset --hard HEAD");
git("deny", "C:\\Git\\cmd\\git.exe clean -fd");
git("deny", "bash.exe -c 'git clean -fd'");
git("deny", "C:\\Program Files\\Git\\bin\\sh.exe -c 'git reset --hard'");
git("allow", "git.exe status -sb");
git("deny", 'pwsh -NoProfile -Command "git reset --hard HEAD"');
git("deny", 'powershell.exe -c "git clean -fd"');
git("allow", 'pwsh -c "git status -sb"');

env("deny", "env");
env("deny", "env | rg TOKEN");
env("deny", "export -p");
env("deny", "printenv");
env("allow", "printenv GITHUB_TOKEN");
env("allow", "env -u GITHUB_TOKEN gh pr create --body-file ./b");
env("allow", "set -euo pipefail");
env("allow", "git reset --soft HEAD~1");
env("allow", 'rg -i "cli|env|gh" hooks/');
env("deny", "declare -x");
env("deny", "typeset -p");
env("deny", "/usr/bin/env");
env("deny", "echo $GITHUB_TOKEN");
env("deny", 'echo "$ANTHROPIC_API_KEY"');
env("deny", 'printf "%s" "${MY_SECRET}"');
env("allow", "echo $HOME");
env("allow", "gh auth status");
env("deny", "sh -c 'env'");
env("deny", "printenv; echo done");
env("deny", "'env'");
env("deny", "env -0");
env("deny", "printenv -0");
env("deny", "export");
env("deny", "declare");
env("allow", "declare -p FOO");
env("allow", "export FOO=1");
env("allow", "set -x");
env("deny", "if echo $GITHUB_TOKEN; then :; fi");
env("deny", 'echo "${GH_TOKEN}"');
env("deny", "env.exe");
env("deny", "C:\\Git\\usr\\bin\\env.exe");

decision("deny", "grep -r foo .");
decision("deny", "ls");
rewrite("fd --glob x .", "find . -name x");
rewrite("fd --glob '*.ts' src", "find src -name '*.ts'");
decision("allow", "find . -maxdepth 3");
decision("allow", "find . -inum 42");
decision("allow", "find . -exec rm {} ;");
rewrite("sd 'a' 'b' f", "sed -i s/a/b/ f");
rewrite("sd 'a' 'b' f", "sed -i 's/a/b/' f");
decision("allow", "sed -i s/a/b/g f");
decision("allow", "git grep foo");
decision("allow", "rg foo");
decision("allow", "ps aux | grep claude");
decision("allow", "cat f | sed s/a/b/");
decision("allow", "cat f |& grep x");
decision("allow", "ps aux | (grep x)");
decision("deny", "true; (grep foo f)");
decision("deny", "(ls)");
decision("deny", "ps aux | (true; grep x)");
decision("deny", "true || grep foo f");
decision("deny", "true && grep foo f");
decision("deny", "bash -c 'ls -la'");
decision("deny", "command ls");
decision("deny", "env ls");
decision("deny", "FOO=1 ls");
decision("deny", "/bin/ls -la");
decision("deny", "if ls; then echo x; fi");
decision("deny", "while ls; do :; done");
decision("deny", "! grep foo f");
decision("deny", "if FOO=1 /bin/ls; then :; fi");
decision("allow", "if rg foo; then echo x; fi");

gh("deny", "gh pr view 12");
gh("deny", "gh -R o/r issue list");
gh("deny", "gh api --paginate repos/o/r/issues");
gh("allow", "gh pr view 12 --json title,state");
gh("allow", "gh pr diff 12");
gh("allow", 'rg "gh pr view" docs/');
gh("deny", "gh release list");
gh("deny", "gh search prs --state open");
gh("allow", "gh search prs --state open --json number,title");
gh("allow", "gh run view 123 --log");
gh("allow", "gh run view 123 --log-failed");
gh("allow", "gh pr create --body-file ./b");
gh("deny", "gh pr view 1; gh pr view 2 --json title");
gh("deny", "gh run view 1 --log; gh pr view 2");
gh("allow", "gh pr view 1 --json title; gh run view 2 --log");
gh("deny", "gh pr 'view' 1");
gh("deny", "env gh pr view 1");
gh("deny", "gh label list");
gh("deny", "gh variable list");
gh("deny", "gh secret list");
gh("allow", "gh label list --json name");

// A heredoc body is data: a line that starts with `set`, `env`, `git reset --hard`, or `grep` is not a
// command. This holds for every way to write the opener, in every guard that parses with readCommand.
const hdBody = "set\nenv\nexport\nprintenv\ndeclare -x\ngit reset --hard\ngit status\ngh pr view 1\ngrep -r x .";
for (const hd of ["<<'EOF'", '<<"EOF"', "<<\\EOF", "<<EOF", "<< EOF"]) {
  const hdCmd = `cat >> /tmp/x.md ${hd}\n${hdBody}\nEOF`;
  env("allow", hdCmd);
  git("allow", hdCmd);
  gh("allow", hdCmd);
  decision("allow", hdCmd);
  env("deny", `${hdCmd}\nenv`); // a command after the end word is still read
  git("deny", `${hdCmd}\ngit reset --hard`);
}
env("allow", "cat > /tmp/i.sh <<-EOF\n\tset\n\tenv\n\tEOF");
env("deny", "cat > /tmp/i.sh <<-EOF\n\tset\n\tEOF\nenv");
// Windows: a CRLF command ends the heredoc at `EOF\r`.
git("allow", "cat > /tmp/x <<EOF\r\ngit reset --hard\r\nEOF\r\n");
git("deny", "cat > /tmp/x <<EOF\r\nx\r\nEOF\r\ngit reset --hard\r\n");
// Two heredocs on one line: both bodies are data.
env("allow", "cat <<'A' <<'B'\nset\nA\nenv\nB");
env("deny", "cat <<'A' <<'B'\nset\nA\nenv\nB\nenv");
// The command line that opens the heredoc is still checked.
git("deny", "git reset --hard <<'EOF'\nx\nEOF");
env("deny", "env -0 && cat <<'EOF'\nx\nEOF");
env("deny", "cat <<EOF $GITHUB_TOKEN\nx\nEOF");
// An unquoted body expands: `$(...)`, a backtick, and `$VAR` still run or print.
git("deny", "cat <<EOF\n$(git reset --hard)\nEOF");
git("deny", "cat <<EOF\n`git reset --hard`\nEOF");
env("deny", "cat <<EOF\necho $GITHUB_TOKEN\nEOF");
env("allow", "cat <<'EOF'\necho $GITHUB_TOKEN\nEOF");
// A shell reads the body of its heredoc as commands, so those lines stay checked.
git("deny", "ssh h sh -s <<'EOF'\ngit reset --hard\nEOF");
git("deny", "ssh h <<'EOF'\ngit reset --hard\nEOF");
git("deny", "cat <<'EOF' | bash\ngit reset --hard\nEOF");
env("deny", "bash <<EOF\nenv\nEOF");
// `<<` that is not a heredoc opener hides nothing: here-string, quoted text, comment, arithmetic.
env("allow", "cat <<< set");
git("deny", "cat <<< x\ngit reset --hard");
git("deny", 'git commit -m "mention <<EOF here"\ngit reset --hard');
git("deny", 'git commit -m "title\n\nmention <<EOF here"\ngit reset --hard');
git("deny", "echo $((1<<3))\ngit reset --hard");
git("deny", "# use <<EOF here\ngit reset --hard");

// Command names match without regard to case, and with a `.exe` suffix or a directory (`/` or `\`) in front.
git("deny", "GIT clean -fd");
git("deny", "Git.EXE reset --hard HEAD");
git("deny", "C:\\Git\\cmd\\GIT.EXE clean -fd");
git("deny", "/usr/bin/env git clean -fd");
git("deny", "C:\\Git\\usr\\bin\\ENV.EXE git clean -fd");
git("deny", "COMMAND git clean -fd");
git("deny", "BASH.EXE -c 'git clean -fd'");
git("deny", 'Pwsh -NoProfile -Command "git reset --hard HEAD"');
git("deny", "if GIT clean -fd; then :; fi");
git("allow", "GIT status -sb");
env("deny", "ENV");
env("deny", "C:\\Git\\usr\\bin\\PRINTENV.EXE");
gh("deny", "GH.EXE pr view 1");
gh("allow", "GH.EXE pr view 1 --json title");
decision("deny", "LS");
decision("deny", "BASH -c 'ls -la'");

// A modern tool that is not installed gets no rewrite and no deny: the classic command runs.
setInstalledTools([]);
decision("allow", "grep -r foo .");
decision("allow", "ls");
decision("allow", "bash -c 'ls -la'");
rewrite("", "find . -name x");
rewrite("", "sed -i s/a/b/ f");
// Each tool gates only its own rule.
setInstalledTools(["fd"]);
rewrite("fd --glob x .", "find . -name x");
rewrite("", "sed -i s/a/b/ f");
decision("allow", "grep -r foo .");
setInstalledTools(["sd"]);
rewrite("sd 'a' 'b' f", "sed -i s/a/b/ f");
rewrite("", "find . -name x");
setInstalledTools(["rg"]);
decision("deny", "grep -r foo .");
decision("allow", "ls");
setInstalledTools(["eza"]);
decision("deny", "ls");
decision("allow", "grep -r foo .");

// PATH lookup, with no override: a stub `sd` in a temp dir is found, `fd` is not.
const bin = mkdtempSync(join(tmpdir(), "guard-test-"));
writeFileSync(join(bin, process.platform === "win32" ? "sd.cmd" : "sd"), "", { mode: 0o755 });
const oldPath = process.env.PATH;
process.env.PATH = bin;
setInstalledTools(undefined);
rewrite("sd 'a' 'b' f", "sed -i s/a/b/ f");
rewrite("", "find . -name x");
process.env.PATH = oldPath;
rmSync(bin, { recursive: true, force: true });

let handler: (event: unknown) => Promise<{ block?: boolean } | void>;
install({ on(_n: string, fn: typeof handler) { handler = fn; } });
const closed = await handler({
  toolName: "bash",
  input: { get command() { throw new Error("boom"); } },
});
total++;
if (!closed?.block) {
  console.log("FAIL fail-closed: expected block on throw");
  fail++;
}

// The handler Pi calls: the decision and the final input. Pretend all four modern tools are installed.
setInstalledTools(["rg", "eza", "fd", "sd"]);
async function entry(expected: "allow" | "deny", toolName: string, input: Record<string, string>, finalCommand?: string) {
  total++;
  const event = { toolName, input: { ...input } };
  const actual = (await handler(event))?.block ? "deny" : "allow";
  const want = JSON.stringify({ ...input, ...(finalCommand === undefined ? {} : { command: finalCommand }) });
  if (actual !== expected || (expected === "allow" && JSON.stringify(event.input) !== want)) {
    console.log(`FAIL handler: expected ${expected} with ${want}, got ${actual} with ${JSON.stringify(event.input)} for ${toolName}`);
    fail++;
  }
}
const run = (e: "allow" | "deny", tool: string, command: string, finalCommand?: string) => entry(e, tool, { command }, finalCommand);

// bash tool: Windows names, quoted executable paths, wrappers.
await run("deny", "bash", "GIT reset --hard HEAD");
await run("deny", "bash", "Git.EXE reset --hard HEAD");
await run("deny", "bash", "/usr/bin/env git clean -fd");
await run("deny", "bash", "C:\\Git\\usr\\bin\\ENV.EXE git clean -fd");
await run("deny", "bash", "BASH.EXE -c 'git clean -fd'");
await run("deny", "bash", 'Pwsh -NoProfile -Command "git reset --hard HEAD"');
await run("deny", "bash", '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command \'git reset --hard HEAD\'');
await run("deny", "bash", '"C:\\Program Files\\Git\\bin\\bash.exe" -c "git clean -fd"');
await run("deny", "bash", "'C:\\Program Files\\Git\\bin\\BASH.EXE' -c 'git clean -fd'");
await run("deny", "bash", '"C:\\Program Files\\Git\\cmd\\git.exe" reset --hard HEAD');
await run("deny", "bash", '& "C:\\Program Files\\Git\\cmd\\git.exe" reset --hard HEAD');
await run("deny", "bash", 'if "C:\\Program Files\\Git\\cmd\\git.exe" clean -fd; then :; fi');
await run("deny", "bash", "GH pr view 12");
await run("deny", "bash", "BASH -c 'ls -la'");
await run("deny", "bash", "ENV");
await run("allow", "bash", '"C:\\Program Files\\Git\\cmd\\git.exe" status -sb');
await run("allow", "bash", '"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command \'git status -sb\'');
await run("allow", "bash", "GH.EXE pr view 12 --json title");
await run("allow", "bash", "echo hello");
// bash tool: the modern-CLI rewrite changes the input.
await run("allow", "bash", "find . -name x", "fd --glob x .");
await run("allow", "bash", "sed -i s/a/b/ f", "sd 'a' 'b' f");

// powershell tool: only the safety guards. No modern-CLI deny or rewrite, and the input stays as typed.
await run("deny", "powershell", "git reset --hard HEAD");
await run("deny", "powershell", "GIT.EXE clean -fd");
await run("deny", "powershell", '& "C:\\Program Files\\Git\\cmd\\git.exe" reset --hard HEAD');
await run("deny", "powershell", "echo $GITHUB_TOKEN");
await run("allow", "powershell", "ls -LiteralPath .");
await run("allow", "powershell", "find . -name x");
await run("allow", "powershell", "sed -i s/a/b/ f");
await run("allow", "powershell", "grep foo f.txt");
await run("allow", "powershell", "gh pr view 12"); // the gh --json rule is a cache policy for bash only
await run("allow", "powershell", "git status -sb");

// Other tools pass untouched, and Pi never redirects to Anvil, whether or not an Emacs server runs here.
await run("allow", "read", "git reset --hard HEAD");
await run("allow", "toString", "git reset --hard HEAD");
await entry("allow", "read", { path: "./notes.org" });
await run("allow", "bash", "git status");
await run("allow", "bash", "git log -1");
await run("allow", "bash", "curl https://example.com");

console.log(`claude-hooks-guard: ${total - fail} passed, ${fail} failed`);
if (fail) process.exit(1);
