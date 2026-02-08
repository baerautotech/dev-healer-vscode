import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const POLICY_ORG = process.env.POLICY_ORG ?? 'baerautotech';
const POLICY_PACK_REPO = process.env.POLICY_PACK_REPO ?? `${POLICY_ORG}/policy-pack`;
const BASE_BRANCH = process.env.POLICY_BASE_BRANCH ?? 'main';
const TOKEN = process.env.POLICY_BOT_TOKEN ?? process.env.GH_TOKEN;

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
const tempDir = mkdtempSync(path.join(tmpdir(), 'policy-propose-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    cwd: options.cwd,
    env: options.env,
  });
  if (result.status !== 0) {
    const details = options.capture ? result.stderr : '';
    throw new Error(`${command} ${args.join(' ')} failed. ${details}`.trim());
  }
  return result.stdout ?? '';
}

function copyPolicyFiles(targetDir) {
  for (const file of policyFiles) {
    const source = path.join(ROOT, file);
    if (!existsSync(source)) continue;
    const destination = path.join(targetDir, file);
    mkdirSync(path.dirname(destination), { recursive: true });
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
  const tokenEncoded = encodeURIComponent(TOKEN);
  const cloneUrl = `https://x-access-token:${tokenEncoded}@github.com/${POLICY_PACK_REPO}.git`;

  run('git', ['clone', '--depth', '1', cloneUrl, tempDir]);
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
  run('git', ['push', 'origin', branchName], { cwd: tempDir });

  await createPullRequest(branchName);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
