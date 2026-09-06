// Self-check: same fixtures as the old test-hooks.sh. `node test.ts`
import {
  blockEnvDump,
  blockGitDestructive,
  enforceModernCli,
  ghJson,
  redirectToAnvil,
  setAnvilAvailable,
  type Decision,
} from "./index.ts";

let fail = 0;

function verdict(d: Decision): "allow" | "deny" {
  return d.blocked ? "deny" : "allow";
}

function check(fn: (c: string) => Decision, expected: "allow" | "deny", command: string) {
  const actual = verdict(fn(command));
  if (actual !== expected) {
    console.log(`FAIL: expected ${expected}, got ${actual} for: ${command}`);
    fail++;
  }
}

function decision(expected: "allow" | "deny", command: string) {
  const d = enforceModernCli(command);
  const actual = verdict(d);
  if (actual !== expected) {
    console.log(`FAIL enforce-modern-cli: expected ${expected}, got ${actual} for: ${command}`);
    fail++;
  }
}

function rewrite(expected: string, command: string) {
  const actual = enforceModernCli(command).rewriteCommand ?? "";
  if (actual !== expected) {
    console.log(`FAIL enforce-modern-cli: expected rewrite ${expected}, got ${actual} for: ${command}`);
    fail++;
  }
}

function redirect(expected: "allow" | "deny", tool: string, input: { command?: string; file_path?: string }) {
  const actual = verdict(redirectToAnvil(tool, input));
  if (actual !== expected) {
    console.log(`FAIL redirect-to-anvil: expected ${expected}, got ${actual} for: ${tool} ${JSON.stringify(input)}`);
    fail++;
  }
}

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

setAnvilAvailable(true);
redirect("deny", "Bash", { command: "git status" });
redirect("allow", "Bash", { command: "git push origin main" });
redirect("deny", "Bash", { command: "curl https://example.com" });
redirect("deny", "Bash", { command: "curl -I https://example.com" });
redirect("allow", "Bash", { command: "curl -X POST https://example.com -d foo" });
redirect("allow", "Bash", { command: "curl https://example.com --head -o out.html" });
redirect("allow", "Bash", { command: "curl https://example.com -X POST -d foo" });
redirect("allow", "Bash", { command: "sed -i s/a/b/ f.txt" });
redirect("allow", "Bash", { command: "sed -n 1,5p f.txt" });
redirect("deny", "Read", { file_path: "./x.org" });
redirect("allow", "Read", { file_path: "./x.md" });
redirect("allow", "Bash", { command: "echo ok; sed -i s/a/b/ f.txt" });
redirect("allow", "Bash", { command: "FOO=1 sed -i s/a/b/ f.txt" });
redirect("allow", "Bash", { command: "/usr/bin/sed -i s/a/b/ f.txt" });
setAnvilAvailable(undefined);

if (fail === 0) console.log("all hook checks passed");
else process.exit(1);
