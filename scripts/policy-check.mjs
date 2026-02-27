import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const POLICY_ORG = process.env.POLICY_ORG ?? 'baerautotech';
const POLICY_PACK_REPO = process.env.POLICY_PACK_REPO ?? `${POLICY_ORG}/policy-pack`;
const BASE_BRANCH = process.env.POLICY_BASE_BRANCH ?? 'main';
const TOKEN = process.env.POLICY_BOT_TOKEN ?? process.env.GH_TOKEN;
const CURRENT_REPO = process.env.GITHUB_REPOSITORY ?? '';
const AGENTS_FILE = 'AGENTS.md';
const AGENTS_REPO_SPECIFIC_ANCHOR = 'content above this section).';

const manifestPath = path.join(ROOT, 'policy-files.json');
if (!existsSync(manifestPath)) {
  console.log('policy-files.json not found; skipping policy check.');
  process.exit(0);
}

if (CURRENT_REPO === POLICY_PACK_REPO) {
  // In the policy pack repo itself, the "remote is source of truth" comparison
  // is not meaningful for pull requests (it would always differ from `main`).
  // Instead, validate that the manifest is internally consistent and that all
  // referenced files exist in the repo at the checked-out revision.
  const files = JSON.parse(readFileSync(manifestPath, 'utf8')).files;
  const missing = files.filter((file) => !existsSync(path.join(ROOT, file)));
  if (missing.length > 0) {
    console.error('Policy pack manifest references missing files:');
    for (const file of missing) console.error(`- ${file}`);
    process.exit(1);
  }
  console.log('Policy pack repo detected; manifest is internally consistent.');
  process.exit(0);
}

if (!TOKEN) {
  console.error('POLICY_BOT_TOKEN is required to validate policy files.');
  process.exit(1);
}

const policyFiles = JSON.parse(readFileSync(manifestPath, 'utf8')).files;

async function fetchPolicyFile(filePath) {
  const url = `https://api.github.com/repos/${POLICY_PACK_REPO}/contents/${filePath}?ref=${BASE_BRANCH}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'policy-pack-check',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch ${filePath}: ${response.status} ${text}`);
  }

  return response.text();
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

  // Tolerate local files that may omit the final trailing newline.
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

const mismatches = [];

for (const file of policyFiles) {
  const localPath = path.join(ROOT, file);
  const localContents = existsSync(localPath) ? readFileSync(localPath, 'utf8') : null;
  const policyContents = await fetchPolicyFile(file);
  if (policyContents === null) {
    mismatches.push(`${file} (missing in policy pack)`);
    continue;
  }
  if (file === AGENTS_FILE) {
    const { managed } = splitAgentsManagedAndSuffix(localContents ?? '', policyContents);
    if (normalizePolicyText(managed) !== normalizePolicyText(policyContents)) {
      mismatches.push(file);
    }
    continue;
  }

  if (normalizePolicyText(localContents ?? '') !== normalizePolicyText(policyContents)) {
    mismatches.push(file);
  }
}

if (mismatches.length > 0) {
  console.error('Policy files are out of sync:');
  for (const file of mismatches) {
    console.error(`- ${file}`);
  }
  console.error('Run policy sync or update via policy-pack.');
  process.exit(1);
}

console.log('Policy files are in sync.');
