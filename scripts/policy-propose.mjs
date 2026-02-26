import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const POLICY_ORG = process.env.POLICY_ORG ?? 'baerautotech';
const POLICY_PACK_REPO = process.env.POLICY_PACK_REPO ?? `${POLICY_ORG}/policy-pack`;
const BASE_BRANCH = process.env.POLICY_BASE_BRANCH ?? 'main';
const TOKEN = process.env.POLICY_BOT_TOKEN ?? process.env.GH_TOKEN;
const AGENTS_FILE = 'AGENTS.md';
const AGENTS_REPO_SPECIFIC_ANCHOR = 'content above this section).';

if (!TOKEN) {
  console.error('POLICY_BOT_TOKEN is required to propose policy updates.');
  process.exit(1);
}

if (process.env.GITHUB_REPOSITORY === POLICY_PACK_REPO) {
  console.log('Policy pack repo detected; skipping propose workflow.');
  process.exit(0);
}

const manifestPath = path.join(ROOT, 'policy-files.json');
if (!existsSync(manifestPath)) {
  console.log('policy-files.json not found; skipping.');
  process.exit(0);
}

const policyFiles = JSON.parse(readFileSync(manifestPath, 'utf8')).files;
const repoName = process.env.GITHUB_REPOSITORY ?? 'unknown-repo';
const branchName = `policy-propose/${repoName.replace('/', '-')}-${Date.now()}`;
const tempRoot = mkdtempSync(path.join(tmpdir(), 'policy-propose-'));
const tempDir = path.join(tempRoot, 'repo');
mkdirSync(tempDir, { recursive: true });
const askPassPath = path.join(tempRoot, 'askpass.sh');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    const details = options.capture ? result.stderr : '';
    throw new Error(`${command} ${args.join(' ')} failed. ${details}`.trim());
  }
  return result.stdout ?? '';
}

function normalizePolicyText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n');
}

function splitAgentsManagedAndSuffix(localContents, canonicalManagedContents) {
  const local = normalizePolicyText(localContents);
  const canonical = normalizePolicyText(canonicalManagedContents);

  if (canonical && local.startsWith(canonical)) {
    return { managed: canonical, suffix: local.slice(canonical.length) };
  }

  const canonicalTrimmed = canonical.endsWith('\n') ? canonical.slice(0, -1) : canonical;
  if (canonicalTrimmed && local.startsWith(canonicalTrimmed)) {
    const remainder = local.slice(canonicalTrimmed.length);
    const suffix = remainder && !remainder.startsWith('\n') ? `\n${remainder}` : remainder;
    return { managed: canonical, suffix };
  }

  const anchorIndex = local.indexOf(AGENTS_REPO_SPECIFIC_ANCHOR);
  if (anchorIndex === -1) {
    return { managed: local, suffix: '' };
  }

  const lineEnd = local.indexOf('\n', anchorIndex);
  if (lineEnd === -1) {
    return { managed: local, suffix: '' };
  }

  return {
    managed: local.slice(0, lineEnd + 1),
    suffix: local.slice(lineEnd + 1),
  };
}

function copyPolicyFiles(targetDir) {
  for (const file of policyFiles) {
    const source = path.join(ROOT, file);
    if (!existsSync(source)) continue;
    const destination = path.join(targetDir, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    if (file === AGENTS_FILE) {
      const localAgents = readFileSync(source, 'utf8');
      const canonicalAgents = existsSync(destination) ? readFileSync(destination, 'utf8') : '';
      const { managed } = splitAgentsManagedAndSuffix(localAgents, canonicalAgents);
      writeFileSync(destination, normalizePolicyText(managed));
      continue;
    }
    copyFileSync(source, destination);
  }
}

async function createPullRequest(branch) {
  const url = `https://api.github.com/repos/${POLICY_PACK_REPO}/pulls`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'policy-pack-propose',
    },
    body: JSON.stringify({
      title: `Policy update from ${repoName}`,
      head: branch,
      base: BASE_BRANCH,
      body: `Proposed policy update from ${repoName}.`,
    }),
  });

  if (response.status === 422) {
    const details = await response.json();
    if (details?.errors?.some((error) => error.message?.includes('A pull request already exists'))) {
      return null;
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create PR: ${response.status} ${text}`);
  }

  return response.json();
}

try {
  // Use a GIT_ASKPASS helper to avoid embedding the token in clone/push URLs.
  // This reduces the risk of leaking secrets into CI logs.
  writeFileSync(
    askPassPath,
    `#!/usr/bin/env sh
case "$1" in
  *Username*) echo "x-access-token" ;;
  *Password*) echo "$POLICY_GIT_TOKEN" ;;
  *) echo "" ;;
esac
`,
    { mode: 0o700 },
  );
  chmodSync(askPassPath, 0o700);

  const gitEnv = {
    POLICY_GIT_TOKEN: TOKEN,
    GIT_ASKPASS: askPassPath,
    GIT_TERMINAL_PROMPT: '0',
  };

  // IMPORTANT: include a username in the URL so git triggers basic-auth and
  // consults GIT_ASKPASS for the password (token). Without this, git can fail
  // with "Repository not found" for private repos without ever prompting.
  const cloneUrl = `https://x-access-token@github.com/${POLICY_PACK_REPO}.git`;
  run('git', ['clone', '--depth', '1', cloneUrl, tempDir], { env: gitEnv });
  run('git', ['checkout', BASE_BRANCH], { cwd: tempDir });
  run('git', ['config', 'user.name', 'policy-bot'], { cwd: tempDir });
  run('git', ['config', 'user.email', 'policy-bot@users.noreply.github.com'], { cwd: tempDir });

  copyPolicyFiles(tempDir);

  const status = run('git', ['status', '--porcelain'], { cwd: tempDir, capture: true });
  if (!status.trim()) {
    console.log('No policy changes detected; skipping.');
    process.exit(0);
  }

  run('git', ['checkout', '-b', branchName], { cwd: tempDir });
  run('git', ['add', ...policyFiles], { cwd: tempDir });
  run('git', ['commit', '-m', `Propose policy update from ${repoName}`], { cwd: tempDir });
  run('git', ['push', 'origin', branchName], { cwd: tempDir, env: gitEnv });

  await createPullRequest(branchName);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
