#!/usr/bin/env node
/**
 * Cleanup a dedicated git worktree folder (and optionally delete branch refs).
 *
 * Safety:
 * - Never targets a `.worktrees` directory name.
 * - Never targets a path inside the repo root.
 *
 * Usage:
 *   node tools/worktrees/cleanup.mjs --dir <path> [--prune] [--delete-branch <branch>] --yes
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

function die(msg) {
  // eslint-disable-next-line no-console
  console.error(`[worktrees:cleanup] ${msg}`);
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

function parseArgs(argv) {
  const out = { dir: null, prune: false, deleteBranch: null, yes: false };
  const args = [...argv];
  while (args.length) {
    const a = args.shift();
    if (a === '--dir') out.dir = args.shift() ?? null;
    else if (a === '--prune') out.prune = true;
    else if (a === '--delete-branch') out.deleteBranch = args.shift() ?? null;
    else if (a === '--yes') out.yes = true;
    else die(`Unknown arg: ${a}`);
  }
  return out;
}

function assertSafeTarget(repoRoot, targetPath) {
  const tp = path.resolve(targetPath);
  const rr = path.resolve(repoRoot);
  if (path.basename(tp) === '.worktrees') die('Refusing to target a directory named `.worktrees` (repo guardrail).');

  const rel = path.relative(rr, tp);
  if (!rel.startsWith('..') && rel !== '..') die(`Refusing to operate on a path inside the repo root: ${tp}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) die('Missing --dir <path>');
  if (!args.yes) die('Refusing to proceed without --yes (this is destructive).');

  const repoRoot = getRepoRoot();
  const target = path.resolve(args.dir);
  assertSafeTarget(repoRoot, target);

  // eslint-disable-next-line no-console
  console.log(`[worktrees:cleanup] repoRoot=${repoRoot}`);
  // eslint-disable-next-line no-console
  console.log(`[worktrees:cleanup] target=${target}`);

  run('git', ['worktree', 'remove', target, '--force'], { stdio: 'inherit' });
  if (args.prune) run('git', ['worktree', 'prune'], { stdio: 'inherit' });
  if (args.deleteBranch) run('git', ['branch', '-D', args.deleteBranch], { stdio: 'inherit' });

  // eslint-disable-next-line no-console
  console.log('[worktrees:cleanup] done');
}

main();

