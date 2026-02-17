#!/usr/bin/env node
/**
 * Create a dedicated git worktree for a branch, outside the repo root.
 *
 * Why: Cursor is folder/workspace-aware (not branch-aware). A separate worktree folder
 * is the most reliable way to keep an agent pinned to a branch.
 *
 * Safety:
 * - Never creates a `.worktrees/` directory in the repo root.
 * - Never creates a worktree path inside the repo root.
 *
 * Usage:
 *   node tools/worktrees/new.mjs <branch> [--dir <path>] [--from <start-point>] [--force]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function die(msg) {
  // eslint-disable-next-line no-console
  console.error(`[worktrees:new] ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed: ${err || `exit ${res.status}`}`);
  }
  return (res.stdout || '').trim();
}

function getRepoRoot() {
  return run('git', ['rev-parse', '--show-toplevel']);
}

function branchExistsLocal(branch) {
  const res = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  return res.status === 0;
}

function safeSlug(branch) {
  return String(branch)
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseArgs(argv) {
  const out = { branch: null, dir: null, from: null, force: false };
  const args = [...argv];
  if (!args.length) return out;
  out.branch = args.shift();
  while (args.length) {
    const a = args.shift();
    if (a === '--dir') out.dir = args.shift() ?? null;
    else if (a === '--from') out.from = args.shift() ?? null;
    else if (a === '--force') out.force = true;
    else die(`Unknown arg: ${a}`);
  }
  return out;
}

function assertSafeWorktreePath(repoRoot, worktreePath) {
  const rp = path.resolve(worktreePath);
  const rr = path.resolve(repoRoot);

  if (path.basename(rp) === '.worktrees') die('Refusing to use a directory named `.worktrees` (repo guardrail).');

  const rel = path.relative(rr, rp);
  if (!rel.startsWith('..') && rel !== '..') die(`Refusing to create a worktree inside the repo root: ${rp}`);
}

function defaultWorktreesBase(repoRoot) {
  const repoName = path.basename(repoRoot);
  return path.resolve(repoRoot, '..', `${repoName}-worktrees`);
}

function defaultWorktreePath(repoRoot, branch) {
  const base = defaultWorktreesBase(repoRoot);
  return path.join(base, safeSlug(branch));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.branch) {
    die('Missing <branch>. Usage: node tools/worktrees/new.mjs <branch> [--dir <path>] [--from <start-point>] [--force]');
  }

  const repoRoot = getRepoRoot();
  const worktreePath = args.dir ? path.resolve(args.dir) : defaultWorktreePath(repoRoot, args.branch);
  assertSafeWorktreePath(repoRoot, worktreePath);

  if (existsSync(worktreePath) && !args.force) die(`Target path already exists: ${worktreePath} (pass --force to proceed)`);

  mkdirSync(path.dirname(worktreePath), { recursive: true });

  const exists = branchExistsLocal(args.branch);
  const from = args.from ?? 'HEAD';

  // eslint-disable-next-line no-console
  console.log(`[worktrees:new] repoRoot=${repoRoot}`);
  // eslint-disable-next-line no-console
  console.log(`[worktrees:new] branch=${args.branch} (existsLocal=${exists})`);
  // eslint-disable-next-line no-console
  console.log(`[worktrees:new] path=${worktreePath}`);

  if (exists) run('git', ['worktree', 'add', worktreePath, args.branch], { stdio: 'inherit' });
  else run('git', ['worktree', 'add', '-b', args.branch, worktreePath, from], { stdio: 'inherit' });

  // eslint-disable-next-line no-console
  console.log(`[worktrees:new] created worktree at ${worktreePath}`);
  // eslint-disable-next-line no-console
  console.log('[worktrees:new] Open that folder in a new Cursor window to keep the session pinned to this branch.');
}

main();

