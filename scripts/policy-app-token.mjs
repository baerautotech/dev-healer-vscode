import crypto from 'node:crypto';
import { appendFileSync } from 'node:fs';

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const appId = requireEnv('POLICY_BOT_APP_ID');
const privateKeyRaw = requireEnv('POLICY_BOT_APP_PRIVATE_KEY');
const owner = process.env.POLICY_BOT_APP_OWNER ?? process.env.GITHUB_REPOSITORY_OWNER;
if (!owner) {
  throw new Error('Missing POLICY_BOT_APP_OWNER or GITHUB_REPOSITORY_OWNER');
}

let permissions;
if (process.env.POLICY_BOT_APP_PERMISSIONS) {
  permissions = JSON.parse(process.env.POLICY_BOT_APP_PERMISSIONS);
}

// Accept both multiline PEM and single-line PEM with literal "\\n".
const privateKey = privateKeyRaw.includes('\\n') ? privateKeyRaw.replace(/\\n/g, '\n') : privateKeyRaw;

const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
const unsigned = `${header}.${payload}`;
const signature = crypto.createSign('RSA-SHA256').update(unsigned).end().sign(privateKey);
const jwt = `${unsigned}.${base64url(signature)}`;

async function api(path, options = {}) {
  const url = `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'policy-bot-app-token',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return null;

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const details = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`GitHub API error ${res.status}: ${details}`);
  }

  return data;
}

async function getInstallationId(account) {
  // Org installation endpoint: https://docs.github.com/rest/apps/apps#get-an-organization-installation-for-the-authenticated-app
  const orgRes = await fetch(`https://api.github.com/orgs/${account}/installation`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'policy-bot-app-token',
    },
  });

  if (orgRes.ok) {
    const data = await orgRes.json();
    return data.id;
  }

  if (orgRes.status !== 404) {
    const text = await orgRes.text();
    throw new Error(`Failed to get org installation for "${account}": ${orgRes.status} ${text}`);
  }

  // User installation endpoint: https://docs.github.com/rest/apps/apps#get-a-user-installation-for-the-authenticated-app
  const userRes = await fetch(`https://api.github.com/users/${account}/installation`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'policy-bot-app-token',
    },
  });

  if (userRes.ok) {
    const data = await userRes.json();
    return data.id;
  }

  if (userRes.status === 404) {
    throw new Error(
      `No GitHub App installation found for "${account}". ` +
        `Install the policy bot GitHub App on the organization (or selected repositories) before removing the legacy PAT.`,
    );
  }

  const text = await userRes.text();
  throw new Error(`Failed to get user installation for "${account}": ${userRes.status} ${text}`);
}

const installationId = await getInstallationId(owner);

const tokenResponse = await api(`/app/installations/${installationId}/access_tokens`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(permissions ? { permissions } : {}),
});

if (!tokenResponse?.token) {
  throw new Error('Installation token response missing token');
}

const outPath = process.env.GITHUB_OUTPUT;
if (!outPath) {
  throw new Error('GITHUB_OUTPUT not set');
}

appendFileSync(outPath, `token=${tokenResponse.token}\n`);
