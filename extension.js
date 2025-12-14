const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

function cfg() {
  const c = vscode.workspace.getConfiguration('devHealer');
  return {
    enabled: c.get('enabled', true),
    autoStart: c.get('autoStart', false),
    // If config isn't explicitly set, prefer the manifest default (package.json sets this to true).
    // Cursor can be finicky about activation timing; when we *are* activated, default to starting the browser.
    autoStartBrowser: c.get('autoStartBrowser', true),
    devCommand: c.get('devCommand', 'npm run dev -- --clearScreen false'),
    errorCooldownMs: c.get('errorCooldownMs', 30_000),
    fixPatchCommand: c.get('fixPatchCommand', 'node tools/cursor-agent-patch.mjs'),
    browserCommand: c.get('browserCommand', 'node tools/dev-healer-browser.mjs'),
    browserUrl: c.get('browserUrl', 'http://127.0.0.1:3000/'),
    browserCaptureMode: c.get('browserCaptureMode', 'both'),
    browserGroupWindowMs: c.get('browserGroupWindowMs', 1500),
    browserAutoRequireGestureMs: c.get('browserAutoRequireGestureMs', 8000),
    browserPromptOnAuthErrors: c.get('browserPromptOnAuthErrors', false),
    // Deprecated-ish: old "patch apply" retries. Queue/pipeline uses fixMaxAttemptsPerIssue.
    fixMaxRetries: c.get('fixMaxRetries', 2),
    fixMaxAttemptsPerIssue: c.get('fixMaxAttemptsPerIssue', 3),
    fixQueueEnabled: c.get('fixQueueEnabled', true),
    fixUseWorktrees: c.get('fixUseWorktrees', true),
    fixBranchPrefix: c.get('fixBranchPrefix', 'dev-healer/'),
    fixRemoteName: c.get('fixRemoteName', 'origin'),
    fixAutoCommit: c.get('fixAutoCommit', true),
    fixAutoPush: c.get('fixAutoPush', true),
    fixCommitMessageTemplate: c.get('fixCommitMessageTemplate', 'Dev Healer: {title} ({id})'),
    // Worktree retention policy:
    // - success: keep 0 (delete immediately)
    // - failure: keep latest 2 (delete older failed worktrees)
    fixCleanupWorktrees: c.get('fixCleanupWorktrees', true),
    fixWorktreeRetainOnSuccess: c.get('fixWorktreeRetainOnSuccess', 0),
    fixWorktreeRetainOnFailure: c.get('fixWorktreeRetainOnFailure', 2),
    // Don't override manifest defaults; allow package.json defaults to apply.
    fixPostFixCommands: c.get('fixPostFixCommands') || [],
    fixShowProgress: c.get('fixShowProgress', true),
    fixRevealOutputOnStart: c.get('fixRevealOutputOnStart', true),
    fixOpenTailTerminal: c.get('fixOpenTailTerminal', false),
    // Agent defaults are defined in package.json; don't override them here.
    fixAgentExplainMode: c.get('fixAgentExplainMode'),
    fixAgentStreamPartial: c.get('fixAgentStreamPartial'),
    fixAgentThinkingMaxChars: c.get('fixAgentThinkingMaxChars'),
    fixAgentStreamMaxChars: c.get('fixAgentStreamMaxChars'),
    fixAgentHeartbeat: c.get('fixAgentHeartbeat'),
    // Post-fix safety + "apply back to workspace" behavior.
    fixPostFixCommandsAllowlist: c.get('fixPostFixCommandsAllowlist'),
    fixCherryPickToWorkspaceOnSuccess: c.get('fixCherryPickToWorkspaceOnSuccess'),
    fixCherryPickStrategy: c.get('fixCherryPickStrategy'),
    browserOcrOnManualReports: c.get('browserOcrOnManualReports', true),
    browserAutoReloadOnFixSuccess: c.get('browserAutoReloadOnFixSuccess'),
    visionOcrCommand: c.get('visionOcrCommand', 'node tools/dev-healer-vision-ocr.mjs'),
  };
}

function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
}

function isSafeChildPath(root, relPath) {
  try {
    const r = String(root || '');
    const rel = String(relPath || '');
    if (!r || !rel) return false;
    const abs = path.resolve(r, rel);
    const rr = path.resolve(r);
    if (!abs.startsWith(rr + path.sep) && abs !== rr) return false;
    return true;
  } catch {
    return false;
  }
}

async function openWorkspaceFiles({ root, relPaths, preserveFocus = false, maxFiles = 12 }) {
  const r = String(root || '');
  if (!r) return;
  const items = Array.isArray(relPaths) ? relPaths : [];
  const unique = Array.from(new Set(items.map((s) => String(s || '').trim()).filter(Boolean)));
  const limited = unique.slice(0, Math.max(1, Number(maxFiles) || 12));
  for (const rel of limited) {
    if (!isSafeChildPath(r, rel)) continue;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(r, rel)));
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus });
    } catch {
      // ignore
    }
  }
}

async function listUnmergedPaths(root) {
  const res = await gitCapture(root, ['diff', '--name-only', '--diff-filter=U']);
  if (res.code !== 0) return [];
  return String(res.stdout || '')
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function offerWorkspaceConflictHelp({ root, logPath, title = 'Dev Healer', id, contextLabel }) {
  const files = await listUnmergedPaths(root);
  if (!files.length) return false;

  const header = `${title}: merge conflicts detected`;
  const detail = [
    contextLabel ? `${contextLabel}` : null,
    id ? `Issue ID: ${id}` : null,
    '',
    `Conflicted files (${files.length}):`,
    ...files.slice(0, 12).map((f) => `- ${f}`),
    files.length > 12 ? `- …and ${files.length - 12} more` : null,
    '',
    'Next steps:',
    '- Resolve conflicts in the files above (look for <<<<<<< / ======= / >>>>>>> markers).',
    '- Then run: git add <each resolved file>',
    '- If needed, you can re-run Dev Healer workspace-apply helpers from the Command Palette.',
  ]
    .filter(Boolean)
    .join('\n');

  if (root && logPath) {
    appendFixLog(root, logPath, `[warn] workspace has merge conflicts after stash pop; manual resolution required`);
    appendFixLog(root, logPath, `[info] conflicted files:\n${files.map((f) => `- ${f}`).join('\n')}`);
    appendFixLog(
      root,
      logPath,
      [
        '[info] to resolve:',
        '- open conflicted files and remove conflict markers',
        '- run: git add <files>',
        '- verify: git diff --name-only --diff-filter=U (should be empty)',
      ].join('\n')
    );
  }

  const copyCommands = async () => {
    const cmds = ['git diff --name-only --diff-filter=U', 'git status', 'git add <resolved files>'].join('\n');
    try {
      await vscode.env.clipboard.writeText(cmds);
      vscode.window.showInformationMessage('Dev Healer: Conflict resolution commands copied to clipboard.', { modal: false });
    } catch {
      vscode.window.showInformationMessage('Dev Healer: Conflict resolution commands:', { modal: false, detail: cmds });
    }
  };

  const openFixLog = async () => {
    try {
      if (!logPath) return;
      await openFileInEditor(logPath);
    } catch {
      // ignore
    }
  };

  const choice = await vscode.window.showWarningMessage(
    header,
    { modal: false, detail },
    'Open conflicted files',
    'Stage resolved',
    'Copy commands',
    'Open fix log'
  );
  if (choice === 'Open conflicted files') {
    await openWorkspaceFiles({ root, relPaths: files, preserveFocus: false, maxFiles: 12 });
  } else if (choice === 'Stage resolved') {
    await stageResolvedWorkspaceConflicts();
  } else if (choice === 'Copy commands') {
    await copyCommands();
  } else if (choice === 'Open fix log') {
    await openFixLog();
  }
  return true;
}

function ignoreFilePath(root) {
  return path.join(ensureDevHealerDir(root), 'ignore.json');
}

function safeJsonParse(txt, fallback) {
  try {
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

function loadIgnoreRules(root) {
  try {
    const p = ignoreFilePath(root);
    if (!fs.existsSync(p)) return [];
    const txt = fs.readFileSync(p, 'utf8');
    const data = safeJsonParse(txt, []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveIgnoreRules(root, rules) {
  try {
    const p = ignoreFilePath(root);
    fs.writeFileSync(p, JSON.stringify(rules, null, 2) + '\n', 'utf8');
  } catch {
    // ignore
  }
}

function ruleKey(rule) {
  try {
    return JSON.stringify(rule);
  } catch {
    return String(rule?.scope || '') + ':' + String(rule?.type || '') + ':' + String(rule?.sigContains || '');
  }
}

function addIgnoreRule(root, rule) {
  const rules = loadIgnoreRules(root);
  const key = ruleKey(rule);
  if (!rules.some((r) => ruleKey(r) === key)) {
    rules.push(rule);
    saveIgnoreRules(root, rules);
  }
}

function matchesIgnoreRule(rule, ctx) {
  if (!rule || typeof rule !== 'object') return false;
  if (rule.scope && ctx.scope && rule.scope !== ctx.scope) return false;
  if (rule.type && ctx.type && String(rule.type) !== String(ctx.type)) return false;

  const norm = (s) => String(s || '').toLowerCase();
  const sig = norm(ctx.sig);
  const msg = norm(ctx.message);
  const loc = norm(ctx.locationUrl);
  const url = norm(ctx.url);

  if (rule.sigContains && !sig.includes(norm(rule.sigContains))) return false;
  if (rule.messageContains && !msg.includes(norm(rule.messageContains))) return false;
  if (rule.locationUrlContains && !loc.includes(norm(rule.locationUrlContains))) return false;
  if (rule.urlContains && !url.includes(norm(rule.urlContains))) return false;

  return true;
}

function isIgnored(root, ctx) {
  const rules = loadIgnoreRules(root);
  return rules.some((r) => matchesIgnoreRule(r, ctx));
}

function ensureDevHealerDir(root) {
  const dir = path.join(root, '.dev-healer');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  return dir;
}

function newIssueId() {
  return `dh_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function appendIssueLog(root, entry) {
  try {
    const dir = ensureDevHealerDir(root);
    const logPath = path.join(dir, 'issues.jsonl');
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

function readLatestIssueFromLog(root) {
  try {
    const dir = ensureDevHealerDir(root);
    const logPath = path.join(dir, 'issues.jsonl');
    if (!fs.existsSync(logPath)) return null;
    const raw = fs.readFileSync(logPath, 'utf8');
    const lines = String(raw || '')
      .split(/\r?\n/g)
      .map((l) => l.trim())
      .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        // We only want the "issue created" style entries, not attempt/outcome breadcrumbs.
        if (!obj || typeof obj !== 'object') continue;
        if (!obj.id || !obj.sig || !obj.type) continue;
        if (Object.prototype.hasOwnProperty.call(obj, 'outcome')) continue;
        return obj;
      } catch {
        // ignore bad lines
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function writeArtifact(root, subdir, filename, content) {
  const base = ensureDevHealerDir(root);
  const dir = path.join(base, subdir);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const p = path.join(dir, filename);
  try {
    fs.writeFileSync(p, content ?? '', 'utf8');
  } catch {
    // ignore
  }
  return p;
}

async function openFileInEditor(filePath) {
  try {
    if (!filePath) return false;
    if (!fs.existsSync(filePath)) return false;
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    return true;
  } catch {
    return false;
  }
}

function quoteShellArg(value) {
  // Minimal quoting for paths/args used in shell command strings.
  // We intentionally keep it simple: wrap in double quotes and escape any internal quotes.
  return `"${String(value ?? '').replace(/"/g, '\\"')}"`;
}

async function revealInOS(targetPath) {
  try {
    if (!targetPath) return false;
    if (!fs.existsSync(targetPath)) return false;
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetPath));
    return true;
  } catch {
    return false;
  }
}

function looksLikeError(line) {
  return [
    /Internal server error/i,
    /Pre-transform error/i,
    /Failed to resolve import/i,
    /Failed to scan for dependencies/i,
    /Expected ">" but found/i,
  ].some((re) => re.test(line));
}

function looksLikeBrowserEvent(line) {
  return line.includes('DEV_HEALER_BROWSER_EVENT ');
}

function parseBrowserEvent(line) {
  try {
    const idx = line.indexOf('DEV_HEALER_BROWSER_EVENT ');
    if (idx < 0) return null;
    return JSON.parse(line.slice(idx + 'DEV_HEALER_BROWSER_EVENT '.length));
  } catch {
    return null;
  }
}

function isLowSignalBrowserError(json) {
  // Common noise: favicon 404s and generic "Failed to load resource" that don't represent an app bug.
  const text = String(json?.text || json?.message || '').toLowerCase();
  const locUrl = String(json?.location?.url || '').toLowerCase();
  if (locUrl.includes('/favicon.ico')) return true;
  if (text.includes('favicon.ico')) return true;
  if (text.includes('failed to load resource') && text.includes('404')) return true;
  // Auth noise: repeated 401/403 spam is rarely auto-fixable (usually missing credentials/env).
  if (text.includes('failed to load resource') && (text.includes('status of 401') || text.includes('status of 403'))) {
    // Allow teams to opt-in if 401s indicate a real app bug in their environment.
    if (!cfg().browserPromptOnAuthErrors) return true;
  }
  return false;
}

function shouldPromptForBrowserEvent(json, captureMode) {
  // Always allow manual "human says it's broken" reports.
  if (json?.type === 'manual-report') return true;

  // In manual mode, do NOT prompt for automatic events (prevents floods).
  if (String(captureMode || 'manual') === 'manual') return false;

  // Only prompt for auto events when we actually captured useful artifacts (or explicitly not skipped).
  if (json?.skippedCapture) return false;

  // Ignore noisy request failures by default.
  if (json?.type === 'requestfailed') return false;

  // Ignore known low-signal console noise (favicon, etc).
  if (json?.type === 'console.error' && isLowSignalBrowserError(json)) return false;

  // Only prompt on high-signal types.
  return json?.type === 'pageerror' || json?.type === 'console.error';
}

function shortPathFromUrl(u) {
  try {
    const url = new URL(String(u || ''));
    return url.pathname || '/';
  } catch {
    return '';
  }
}

function buildIssueTitle({ source, json, sig, count }) {
  if (source === 'vite') return 'Dev Healer: Vite error';
  if (json?.type === 'manual-report') {
    const p = shortPathFromUrl(json?.url);
    const sel = json?.element?.selector ? ` (${json.element.selector})` : '';
    return `Dev Healer: Repair report${p ? ` on ${p}` : ''}${sel}`;
  }
  if (count && count > 1) return `Dev Healer: Browser errors (${count})`;
  const p = shortPathFromUrl(json?.url);
  if (json?.type === 'pageerror') return `Dev Healer: Page crash${p ? ` on ${p}` : ''}`;
  if (json?.type === 'console.error') return `Dev Healer: Console error${p ? ` on ${p}` : ''}`;
  return `Dev Healer: Browser issue${p ? ` on ${p}` : ''}`;
}

function buildFixPrompt(excerpt, kind = 'runtime', { fileRoot } = {}) {
  const root = workspaceRoot();
  const effectiveRoot = fileRoot || root;

  const readFileExcerpt = (relPath, { aroundLine, before = 50, after = 50, maxBytes = 18_000 } = {}) => {
    if (!effectiveRoot) return null;
    try {
      const abs = path.join(effectiveRoot, relPath);
      if (!fs.existsSync(abs)) return null;
      const st = fs.statSync(abs);
      if (!st?.isFile?.()) return null;
      if (st.size > 512_000) return `[file omitted: ${relPath} (too large: ${st.size} bytes)]`;
      const txt = fs.readFileSync(abs, 'utf8');
      const lines = txt.split('\n');
      let start = 0;
      let end = Math.min(lines.length, 220);
      if (Number.isFinite(aroundLine) && aroundLine > 0) {
        const idx = Math.max(0, Math.min(lines.length - 1, aroundLine - 1));
        start = Math.max(0, idx - before);
        end = Math.min(lines.length, idx + after + 1);
      }
      let body = lines.slice(start, end).join('\n');
      if (body.length > maxBytes) body = body.slice(0, maxBytes) + '\n/* ...truncated... */\n';
      const range = `L${start + 1}-L${end}`;
      return `--- ${relPath} (${range}) ---\n${body}`;
    } catch {
      return null;
    }
  };

  const extractPathLineRefs = (text) => {
    const out = [];
    const s = String(text || '');
    // Matches: src/foo/bar.tsx:123:45 or /abs/path/.../src/foo.ts:12:3
    const re = /((?:\/Users\/[^:\n]+\/)?src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|md)):(\d+)(?::\d+)?/g;
    let m;
    while ((m = re.exec(s))) {
      const rawPath = String(m[1] || '').trim();
      const rel = rawPath.includes('/src/') ? rawPath.slice(rawPath.indexOf('src/')) : rawPath;
      const line = Number(m[2] || 0);
      out.push({ relPath: rel, line });
      if (out.length >= 6) break;
    }
    return out;
  };

  const extractRepoPaths = (text) => {
    const out = new Set();
    const s = String(text || '');
    const re = /(src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|md))/g;
    let m;
    while ((m = re.exec(s))) {
      out.add(String(m[1]));
      if (out.size >= 8) break;
    }
    return Array.from(out);
  };

  const buildContextBlock = () => {
    if (!root) return '';
    const blocks = [];

    if (kind === 'manual-ui') {
      const likely = [
        'src/components/crm/calendar/components/CalendarControls.tsx',
        'src/components/crm/calendar/CrmCalendarModern.tsx',
        'src/components/crm/calendar/hooks/useCalendar.ts',
      ];
      for (const p of likely) {
        const ex = readFileExcerpt(p, { maxBytes: 18_000 });
        if (ex) blocks.push(ex);
      }
    }

    const refs = extractPathLineRefs(excerpt);
    for (const r of refs) {
      const ex = readFileExcerpt(r.relPath, { aroundLine: r.line, before: 70, after: 70, maxBytes: 18_000 });
      if (ex) blocks.push(ex);
    }

    const paths = extractRepoPaths(excerpt).slice(0, 6);
    for (const p of paths) {
      if (refs.some((r) => r.relPath === p)) continue;
      const ex = readFileExcerpt(p, { maxBytes: 10_000 });
      if (ex) blocks.push(ex);
    }

    if (!blocks.length) return '';
    return ['Context (read-only file excerpts):', blocks.join('\n\n'), ''].join('\n');
  };

  const repoPlaybook = [
    'Repo playbook (follow these):',
    '- State management is mandatory: prefer React Context providers; avoid ad-hoc prop drilling/local state (except truly ephemeral UI).',
    '- Keep SRP: split components/hooks/utils; prefer <300 lines per file; keep complexity low.',
    '- TypeScript: no `any`; fully type props/state; keep imports clean.',
    '- Visual language: use existing Halfpipe styling + CSS variables; Phosphor icons only.',
    '- Do not "fix" external auth/CORS/network errors unless the requested change is directly about that system.',
    '- Brownfield rule: prefer targeted edits; do NOT rewrite entire files unless absolutely necessary.',
    '- If you must refactor, keep the diff small and localized; preserve existing behavior outside the fix.',
    '',
    'Docs (consult if unsure):',
    '- src/docs/SYSTEM_ARCHITECTURE.md (contexts, architecture)',
    '- src/docs/CODING_STANDARDS.md (mandatory rules)',
    '- src/docs/theming/README.md (tokens/variables)',
    '',
    'Process:',
    '- You do NOT have direct filesystem access. Only use the provided excerpts below.',
    '- Output edits as a single JSON object between markers BEGIN_DEV_HEALER_EDITS_JSON and END_DEV_HEALER_EDITS_JSON (no unified diff).',
    '- Use exact copy/paste snippets from the provided excerpts for any "find" blocks.',
    '',
  ].join('\n');

  if (kind === 'manual-ui') {
    return [
      'You are a code repair agent.',
      'Goal: implement the requested UI/UX behavior described below.',
      '',
      'Constraints:',
      '- Output ONLY the edits JSON between BEGIN_DEV_HEALER_EDITS_JSON and END_DEV_HEALER_EDITS_JSON.',
      '- No markdown.',
      '- Do NOT modify lockfiles (package-lock.json).',
      '- Do NOT attempt to fix external network/auth/CORS errors unless they are directly caused by this UI change.',
      '',
      repoPlaybook,
      buildContextBlock(),
      'UI issue report:',
      excerpt,
      '',
    ].join('\n');
  }
  return [
    'You are a code repair agent.',
    'Goal: fix the runtime Vite error(s) shown below, with minimal changes, so HMR/dev server recovers.',
    '',
    'Constraints:',
    '- Output ONLY the edits JSON between BEGIN_DEV_HEALER_EDITS_JSON and END_DEV_HEALER_EDITS_JSON.',
    '- No markdown.',
    '- Do NOT modify lockfiles (package-lock.json).',
    '',
    repoPlaybook,
    buildContextBlock(),
    'Runtime error excerpt:',
    excerpt,
    '',
  ].join('\n');
}

function rewriteFixPatchCommandForWorktree(cmdText, { root, execCwd } = {}) {
  const raw = String(cmdText || '').trim();
  if (!raw) return raw;
  if (!root) return raw;
  if (!execCwd) return raw;
  // If we're running inside a worktree, the worktree may be checked out at an older commit and
  // contain stale tool scripts. Prefer running the tool from the main workspace root.
  if (path.resolve(execCwd) === path.resolve(root)) return raw;

  const scriptRel = 'tools/cursor-agent-patch.mjs';
  const scriptAbs = path.join(root, scriptRel);
  if (!fs.existsSync(scriptAbs)) return raw;

  // Replace occurrences of the relative script path with an absolute path (quoted for shell usage).
  // This keeps user overrides (extra flags) intact.
  if (raw.includes(scriptRel)) {
    return raw.split(scriptRel).join(quoteShellArg(scriptAbs));
  }
  return raw;
}

function extractContextPathsFromPrompt(promptText) {
  const out = new Set();
  const s = String(promptText || '');
  // Context blocks we generate look like: "--- src/foo/bar.tsx (L1-L80) ---"
  const re = /^---\s+(src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|md))\s+\(L\d+-L\d+\)\s+---\s*$/gm;
  let m;
  while ((m = re.exec(s))) {
    if (m?.[1]) out.add(String(m[1]));
    if (out.size >= 6) break;
  }
  // Fallback: any mentioned src paths in the prompt.
  if (!out.size) {
    const re2 = /(src\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|scss|md))/g;
    while ((m = re2.exec(s))) {
      out.add(String(m[1]));
      if (out.size >= 6) break;
    }
  }
  return Array.from(out);
}

async function buildRepoSnapshotBlock({ cwd, root, promptText, baseRef }) {
  try {
    const lines = [];
    lines.push('Repo snapshot (read-only; use this to ensure your diff applies cleanly):');
    if (baseRef) lines.push(`- baseRef: ${String(baseRef).trim()}`);

    const head = await gitCapture(cwd, ['rev-parse', 'HEAD']);
    if (head.code === 0) lines.push(`- worktree HEAD: ${String(head.stdout || '').trim()}`);

    const st = await gitCapture(cwd, ['status', '--porcelain']);
    if (st.code === 0) {
      const s = String(st.stdout || '').trim();
      lines.push(`- git status --porcelain: ${s ? s.split('\n').slice(0, 12).join(' | ') : '(clean)'}`);
    }

    const files = extractContextPathsFromPrompt(promptText).slice(0, 6);
    if (files.length) {
      lines.push('');
      lines.push('File excerpts from HEAD (via `git show`):');
    }

    for (const p of files) {
      const show = await gitCapture(cwd, ['show', `HEAD:${p}`]);
      if (show.code !== 0) {
        lines.push(`--- ${p} (git show failed; file may be new/untracked) ---`);
        continue;
      }
      let body = String(show.stdout || '');
      // Keep prompt size under control.
      const maxBytes = 18_000;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        body = body.slice(0, maxBytes) + '\n/* ...truncated... */\n';
      }
      const headLines = body.split('\n').slice(0, 140).join('\n');
      lines.push(`--- ${p} (HEAD, first 140 lines) ---`);
      lines.push(headLines);
    }

    lines.push('');
    return lines.join('\n');
  } catch (e) {
    if (root) {
      try {
        appendFixLog(root, lastFixLogPath, `[warn] failed to build repo snapshot: ${String(e?.message || e)}`);
      } catch {}
    }
    return '';
  }
}

function splitCommandShell(cmd) {
  return { command: cmd, args: [], shell: true };
}

async function spawnWithInputCapture({ command, args, cwd, shell, env, input }) {
  const child = cp.spawn(command, args, { cwd, shell, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => (stdout += d.toString()));
  child.stderr.on('data', (d) => (stderr += d.toString()));
  if (typeof input === 'string') {
    child.stdin.write(input);
  }
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? 0)));
  return { code, stdout, stderr };
}

async function spawnWithStreaming({ command, args, cwd, shell, env, input, onStdout, onStderr }) {
  const child = cp.spawn(command, args, { cwd, shell, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => {
    const s = d.toString();
    stdout += s;
    try {
      onStdout?.(s);
    } catch {
      // ignore
    }
  });
  child.stderr.on('data', (d) => {
    const s = d.toString();
    stderr += s;
    try {
      onStderr?.(s);
    } catch {
      // ignore
    }
  });
  if (typeof input === 'string') {
    child.stdin.write(input);
  }
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('close', (c) => resolve(c ?? 0)));
  return { code, stdout, stderr };
}

function ensureViteHostFlag(cmd) {
  // If user already specified a host, do nothing.
  if (/\s--host(\s|$)/.test(cmd)) return cmd;

  // If running via npm, args must come after `--`.
  if (/\bnpm\s+run\s+\S+/.test(cmd)) {
    if (/\s--\s/.test(cmd)) return `${cmd} --host`;
    return `${cmd} -- --host`;
  }

  // Direct vite invocation (or other runners) typically accept --host directly.
  return `${cmd} --host`;
}

async function runPatchCommand(promptText, { id, title, logPath, progress, attempt, cwd, agentOverrides } = {}) {
  const root = workspaceRoot();
  if (!root) throw new Error('No workspace folder open');
  const execCwd = cwd || root;
  const { fixPatchCommand } = cfg();
  const effectiveFixPatchCommand = rewriteFixPatchCommandForWorktree(fixPatchCommand, { root, execCwd });
  const { command, args, shell } = splitCommandShell(effectiveFixPatchCommand);

  progress?.report?.({ message: 'Generating patch (Cursor Agent)…' });
  if (root && logPath) {
    const present = envKeyPresence(root);
    appendFixLog(root, logPath, `[auth] workspaceRoot=${root}`);
    appendFixLog(root, logPath, `[auth] execCwd=${execCwd}`);
    appendFixLog(root, logPath, `[auth] .env(.local) has CURSOR_API_KEY: ${present.found ? `yes (${present.file})` : 'no'}`);
    appendFixLog(root, logPath, `[${new Date().toISOString()}] ${String(title || 'Dev Healer')} (${id || ''})`);
    appendFixLog(root, logPath, `[step] generate patch: ${effectiveFixPatchCommand}`);
  }

  let lastOutputAt = Date.now();
  const startedAt = Date.now();
  let lastLoggedHeartbeatAt = 0;
  const heartbeat = setInterval(() => {
    // If the agent command is quiet, emit a heartbeat so the user knows we're alive.
    // The patcher now emits its own phase/elapsed heartbeats; keep this as a low-noise fallback only.
    if (Date.now() - lastOutputAt < 12_000) return;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const quietFor = Math.round((Date.now() - lastOutputAt) / 1000);
    progress?.report?.({ message: `Generating patch… (${elapsed}s)` });
    // Avoid spamming the output/log; write at most once per minute if we're really stuck.
    const now = Date.now();
    if (root && logPath && quietFor >= 30 && now - lastLoggedHeartbeatAt >= 60_000) {
      lastLoggedHeartbeatAt = now;
      appendFixLog(root, logPath, `[still running] generating patch… (${elapsed}s, quiet ${quietFor}s)`);
    }
  }, 10_000);

  // Cursor Agent partial streaming often arrives without newlines; a line-buffered writer would
  // appear "silent" for long stretches. Chunk-buffer instead so the Output Channel stays alive
  // without turning into one-word-per-line spam.
  const agentStderr = createFixChunkWriter(root, logPath);
  const patchRes = await spawnWithStreaming({
    command,
    args,
    cwd: execCwd,
    shell,
    env: {
      ...process.env,
      // If the extension host didn't inherit CURSOR_API_KEY but it's in root env files,
      // inject it explicitly so `tools/cursor-agent-patch.mjs` and `cursor agent` can authenticate.
      ...(process.env.CURSOR_API_KEY
        ? {}
        : (() => {
            const k = readEnvValueFromRoot(root, 'CURSOR_API_KEY');
            if (k.found && k.value) {
              if (root && logPath) appendFixLog(root, logPath, `[auth] injecting CURSOR_API_KEY from ${k.file} into patch process env`);
              return { CURSOR_API_KEY: k.value };
            }
            return {};
          })()),
      DEV_HEALER_ISSUE_ID: String(id || ''),
      DEV_HEALER_AGENT_EXPLAIN_MODE: String((agentOverrides?.explainMode ?? cfg().fixAgentExplainMode) || 'summary'),
      DEV_HEALER_AGENT_STREAM_PARTIAL: String((agentOverrides?.streamPartial ?? cfg().fixAgentStreamPartial) ? '1' : ''),
      DEV_HEALER_AGENT_THINKING_MAX_CHARS: String(
        Math.max(400, Math.min(20000, Number(agentOverrides?.thinkingMaxChars ?? cfg().fixAgentThinkingMaxChars) || 2500))
      ),
      DEV_HEALER_AGENT_STREAM_MAX_CHARS: String(
        Math.max(1000, Math.min(200000, Number(agentOverrides?.streamMaxChars ?? cfg().fixAgentStreamMaxChars) || 20000))
      ),
      DEV_HEALER_AGENT_HEARTBEAT: String((agentOverrides?.heartbeat ?? cfg().fixAgentHeartbeat) ? '1' : ''),
      // Allow tools/cursor-agent-patch.mjs to load `.env(.local)` from the original workspace root
      // even when we execute inside an isolated git worktree.
      DEV_HEALER_WORKSPACE_ROOT: root,
    },
    input: promptText,
    // Don't stream stdout (diff) to avoid massive output; stream stderr (auth/errors) instead.
    onStderr: (s) => {
      lastOutputAt = Date.now();
      agentStderr.write(s);
    },
  });
  agentStderr.flush();
  clearInterval(heartbeat);
  if (patchRes.code !== 0) {
    const tail = (s) => String(s || '').slice(-4000);
    throw new Error(`Patch command failed: ${patchRes.code}\n\nstderr:\n${tail(patchRes.stderr)}\n\nstdout:\n${tail(patchRes.stdout)}`);
  }
  const rawPatch = patchRes.stdout;
  const sanitized = sanitizeUnifiedDiffPatch(rawPatch);
  const patch = sanitized.patch;

  if (!patch.includes('diff --git ')) {
    throw new Error('Patch output did not contain a git diff. Check Cursor Agent auth/model.');
  }

  // Best-effort validation: don't spam scary warnings if `git apply --check` succeeds.
  // (git is definitive; our hunk validator can be pessimistic.)
  const v = validateUnifiedDiffHunks(patch);

  // Save the patch so the user can inspect what the agent produced (super helpful when git apply fails).
  if (root) {
    try {
      const n = Number(attempt || 0);
      const suffix = n > 0 ? `.attempt-${n}` : '';
      if (sanitized.changed) writeArtifact(root, 'patches', `${id || 'unknown'}${suffix}.raw.diff`, rawPatch);
      writeArtifact(root, 'patches', `${id || 'unknown'}${suffix}.diff`, patch);
      if (logPath) appendFixLog(root, logPath, `[info] patch generated (${patch.length} bytes) and saved under .dev-healer/patches/`);
    } catch {
      // ignore
    }
  }

  progress?.report?.({ message: 'Applying patch (git apply)…' });
  if (root && logPath) appendFixLog(root, logPath, `[step] apply patch: git apply --whitespace=nowarn -`);

  // Preflight: `git apply --check` catches "corrupt patch" cleanly and avoids partial apply side effects.
  if (root && logPath) appendFixLog(root, logPath, `[step] preflight: git apply --check --whitespace=nowarn -`);
  const checkStderr = createFixLineWriter(root, logPath);
  const checkRes = await spawnWithStreaming({
    command: 'git',
    args: ['apply', '--check', '--whitespace=nowarn', '-'],
    cwd: execCwd,
    shell: false,
    env: process.env,
    input: patch,
    onStderr: (s) => {
      lastOutputAt = Date.now();
      checkStderr.write(s);
    },
  });
  checkStderr.flush();
  if (checkRes.code !== 0) {
    if (sanitized.changed && root && logPath) {
      appendFixLog(
        root,
        logPath,
        `[warn] patch sanitizer applied: fixedMissingPrefixes=${sanitized.fixedMissingPrefixes} fixedHunkHeaders=${sanitized.fixedHunkHeaders} fixedHunkRanges=${sanitized.fixedHunkRanges} droppedNonDiffLines=${sanitized.droppedNonDiffLines}`
      );
    }
    if (!v.ok && root && logPath) {
      const details = v.errors.slice(0, 6).map((e) => `- ${e}`).join('\n');
      appendFixLog(
        root,
        logPath,
        [
          '[warn] patch validator detected possible invalid hunk ranges; `git apply --check` failed (details below)',
          details ? `Details:\n${details}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
    }
    const tail = (s) => String(s || '').slice(-4000);

    // Add high-signal diagnostics to help the next retry produce an applyable diff.
    // (The agent often "handwrites" a diff or targets a stale file version.)
    let diag = '';
    try {
      const s = String(checkRes.stderr || '');
      const paths = new Set();
      const addAll = (re) => {
        let m;
        while ((m = re.exec(s))) {
          if (m?.[1]) paths.add(String(m[1]).trim());
        }
      };
      addAll(/patch failed:\s+([^:\n]+):\d+/g);
      addAll(/error:\s+([^:\n]+):\s+patch does not apply/g);
      addAll(/error:\s+([^:\n]+):\s+already exists in working directory/g);

      const head = await gitCapture(execCwd, ['rev-parse', 'HEAD']);
      const st = await gitCapture(execCwd, ['status', '--porcelain']);
      const headLine = head.code === 0 ? String(head.stdout || '').trim() : '';
      const stLine = st.code === 0 ? String(st.stdout || '').trim() : '';

      const lines = [];
      lines.push('--- Dev Healer Apply Diagnostics ---');
      if (headLine) lines.push(`worktree HEAD: ${headLine}`);
      lines.push(`worktree status: ${stLine ? stLine.split('\n').slice(0, 8).join(' | ') : '(clean)'}`);
      lines.push('');

      // Include small excerpts for the files that failed to apply so the agent can anchor to reality.
      const list = Array.from(paths).slice(0, 5);
      for (const p of list) {
        const abs = path.join(execCwd, p);
        let tracked = 'unknown';
        try {
          const ls = await gitCapture(execCwd, ['ls-files', '--error-unmatch', p]);
          tracked = ls.code === 0 ? 'yes' : 'no';
        } catch {}
        const exists = fs.existsSync(abs) ? 'yes' : 'no';
        lines.push(`file: ${p} (exists=${exists}, tracked=${tracked})`);
        if (fs.existsSync(abs)) {
          try {
            const txt = fs.readFileSync(abs, 'utf8');
            const headText = txt.split('\n').slice(0, 80).join('\n');
            lines.push('--- file head (first 80 lines) ---');
            lines.push(headText.slice(0, 6000));
          } catch {}
        }
        lines.push('');
      }

      diag = lines.join('\n').trim();
      if (diag && root && logPath) appendFixLog(root, logPath, diag);
    } catch {
      // ignore diagnostics failures
    }

    throw new Error(
      [
        `git apply --check failed: ${checkRes.code}`,
        '',
        'This usually means the patch is malformed (corrupt hunk headers) or doesn’t match the current files.',
        'If this repeats, the agent must output the exact output of `git diff --no-color`.',
        '',
        `stderr:\n${tail(checkRes.stderr)}`,
        '',
        `stdout:\n${tail(checkRes.stdout)}`,
        '',
        diag ? diag : '',
      ].join('\n')
    );
  }

  const applyStderr = createFixLineWriter(root, logPath);
  const applyRes = await spawnWithStreaming({
    command: 'git',
    args: ['apply', '--whitespace=nowarn', '-'],
    cwd: execCwd,
    shell: false,
    env: process.env,
    input: patch,
    onStderr: (s) => {
      lastOutputAt = Date.now();
      applyStderr.write(s);
    },
  });
  applyStderr.flush();
  if (applyRes.code !== 0) {
    const tail = (s) => String(s || '').slice(-4000);
    throw new Error(`git apply failed: ${applyRes.code}\n\nstderr:\n${tail(applyRes.stderr)}\n\nstdout:\n${tail(applyRes.stdout)}`);
  }
}

function validateUnifiedDiffHunks(patchText) {
  // Validates that each hunk header's old/new line counts match the actual number of lines in the hunk.
  // If they don't, `git apply` will often error with "corrupt patch".
  const errors = [];
  const lines = String(patchText || '').split('\n');
  const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('@@ ')) continue;
    const m = line.match(hunkHeader);
    if (!m) {
      errors.push(`bad hunk header at line ${i + 1}: ${line.slice(0, 120)}`);
      continue;
    }
    const oldCount = Number(m[2] || '1');
    const newCount = Number(m[4] || '1');
    let oldSeen = 0;
    let newSeen = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.startsWith('@@ ') || l.startsWith('diff --git ')) break;
      if (l.startsWith('+') && !l.startsWith('+++')) newSeen++;
      else if (l.startsWith('-') && !l.startsWith('---')) oldSeen++;
      else if (l.startsWith('\\')) {
        // "\ No newline at end of file" — ignore
      } else {
        oldSeen++;
        newSeen++;
      }
      i = j; // advance outer loop to end of hunk
    }
    if (oldSeen !== oldCount || newSeen !== newCount) {
      errors.push(`hunk count mismatch near line ${i + 1}: expected -${oldCount}/+${newCount}, saw -${oldSeen}/+${newSeen}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

async function generatePatchOnly(promptText) {
  const root = workspaceRoot();
  if (!root) throw new Error('No workspace folder open');
  const { fixPatchCommand } = cfg();
  const { command, args, shell } = splitCommandShell(fixPatchCommand);

  const patchRes = await spawnWithInputCapture({
    command,
    args,
    cwd: root,
    shell,
    env: { ...process.env, DEV_HEALER_WORKSPACE_ROOT: root },
    input: promptText,
  });
  if (patchRes.code !== 0) {
    const tail = (s) => String(s || '').slice(-4000);
    throw new Error(`Patch command failed: ${patchRes.code}\n\nstderr:\n${tail(patchRes.stderr)}\n\nstdout:\n${tail(patchRes.stdout)}`);
  }
  const patch = patchRes.stdout;

  if (!patch.includes('diff --git ')) {
    throw new Error('Patch output did not contain a git diff. Auth may be failing or the agent did not follow instructions.');
  }

  return patch;
}

function envKeyPresence(rootDir) {
  // We never read/emit the value. Just detect presence so users know what will happen.
  const candidates = ['.env.local', '.env'];
  for (const f of candidates) {
    try {
      const p = path.join(rootDir, f);
      if (!fs.existsSync(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      if (/^\s*CURSOR_API_KEY\s*=.+/m.test(txt)) return { found: true, file: f };
    } catch {
      // ignore
    }
  }
  return { found: false, file: null };
}

function readEnvValueFromRoot(rootDir, key) {
  // Read a single env var from `.env.local` / `.env` in the workspace root.
  // NOTE: We never log the value; we only use it to ensure child processes inherit it.
  const candidates = ['.env.local', '.env'];
  const k = String(key || '').trim();
  if (!k) return { found: false, file: null, value: null };
  const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\s*(?:export\\s+)?${escaped}\\s*=\\s*(.+)\\s*$`, 'm');
  for (const f of candidates) {
    try {
      const p = path.join(rootDir, f);
      if (!fs.existsSync(p)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(re);
      if (!m) continue;
      let v = String(m[1] || '').trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!v) continue;
      return { found: true, file: f, value: v };
    } catch {
      // ignore
    }
  }
  return { found: false, file: null, value: null };
}

function createWatchedTerminal({ name, commandText, env, onLine, onExit }) {
  const writeEmitter = new vscode.EventEmitter();
  const closeEmitter = new vscode.EventEmitter();
  let proc = null;
  let buffer = '';

  const pty = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {
      const root = workspaceRoot();
      if (!root) {
        writeEmitter.fire('No workspace folder open.\r\n');
        closeEmitter.fire(0);
        return;
      }

      writeEmitter.fire(`[dev-healer] starting: ${commandText}\r\n`);

      const { command, args, shell } = splitCommandShell(commandText);
      proc = cp.spawn(command, args, { cwd: root, shell, env: { ...process.env, ...(env || {}) } });

      const onData = (d) => {
        const text = d.toString();
        writeEmitter.fire(text.replace(/\n/g, '\r\n'));
        buffer += text;
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          onLine(line);
        }
      };

      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('close', (code) => {
        writeEmitter.fire(`\r\n[dev-healer] ${name} process exited: ${code}\r\n`);
        closeEmitter.fire(code ?? 0);
        proc = null;
        try {
          onExit?.(code ?? 0);
        } catch {
          // ignore
        }
      });
    },
    close: () => {
      if (proc) {
        try {
          proc.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    },
    handleInput: () => {},
  };

  const terminal = vscode.window.createTerminal({ name, pty });
  return { terminal, stop: () => pty.close() };
}

let watched = null;
let watchedBrowser = null;
let recent = [];
let recentBrowser = [];
let lastSigAt = new Map();
let lastBrowserSigAt = new Map();
let hasShownAuthHint = false;
let pendingBrowserGroups = new Map(); // sig -> { firstAt, lastAt, events, timer }
let pendingManualSession = null; // { id, sig, json, events, timer }
let ocrCache = new Map(); // screenshot path -> OCR text
let output = null;
let fixOutput = null;
let statusItem = null;
let lastFixLogPath = null;
let fixTailTerminal = null;
let fixQueue = [];
let fixQueueRunning = false;
let fixQueueActiveId = null;

function getFixOutput() {
  if (!fixOutput) {
    fixOutput = vscode.window.createOutputChannel('Dev Healer Fix');
  }
  return fixOutput;
}

function setStatus(text, tooltip) {
  try {
    if (!statusItem) return;
    statusItem.text = text;
    statusItem.tooltip = tooltip || '';
    statusItem.show();
  } catch {
    // ignore
  }
}

function safeWorktreeName(id) {
  return String(id || 'issue')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 80);
}

async function gitCapture(cwd, args, input) {
  return await spawnWithInputCapture({ command: 'git', args, cwd, shell: false, env: process.env, input });
}

async function gitStreaming(cwd, args, { onStdout, onStderr, input } = {}) {
  return await spawnWithStreaming({ command: 'git', args, cwd, shell: false, env: process.env, input, onStdout, onStderr });
}

async function ensureWorktreeForIssue(root, { id, baseRef, branch }) {
  const dir = path.join(ensureDevHealerDir(root), 'worktrees');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  const worktreePath = path.join(dir, safeWorktreeName(id));

  // If the worktree already exists, reuse it. (Do NOT try to force-reset the branch with `-B` while
  // it's checked out by that same worktree; git will error: "cannot force update the branch ... used by worktree".)
  if (fs.existsSync(worktreePath)) {
    const inside = await gitCapture(worktreePath, ['rev-parse', '--is-inside-work-tree']);
    if (inside.code === 0 && String(inside.stdout || '').trim() === 'true') {
      // Best-effort ensure the expected branch is checked out.
      const cur = await gitCapture(worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const curBranch = String(cur.stdout || '').trim();
      if (cur.code === 0 && curBranch && curBranch !== branch) {
        await gitCapture(worktreePath, ['checkout', branch]);
      }
      return worktreePath;
    }
    throw new Error(`Worktree path already exists but is not a git worktree: ${worktreePath}`);
  }

  // Create a worktree branch at baseRef. This lets users keep editing their main working tree safely.
  // `-B` resets/creates the branch locally (safe here because it's not checked out anywhere yet).
  // Prune first to clear any stale worktree metadata.
  await gitCapture(root, ['worktree', 'prune']);
  const res = await gitCapture(root, ['worktree', 'add', '-B', branch, worktreePath, baseRef]);
  if (res.code !== 0) {
    throw new Error(`git worktree add failed: ${res.code}\n\nstderr:\n${res.stderr}\n\nstdout:\n${res.stdout}`);
  }
  return worktreePath;
}

function formatCommitMessage({ id, title, sig }) {
  const tpl = String(cfg().fixCommitMessageTemplate || 'Dev Healer: {title} ({id})');
  return tpl
    .replace(/\{id\}/g, String(id || ''))
    .replace(/\{title\}/g, String(title || '').slice(0, 140))
    .replace(/\{sig\}/g, String(sig || '').slice(0, 140));
}

async function runPostFixCommands({ cwd, root, logPath }) {
  const cmds = cfg().fixPostFixCommands;
  const list = Array.isArray(cmds) ? cmds.filter(Boolean).map(String) : [];
  if (!list.length) return;

  // Enterprise-hardening: optional allowlist. When set (non-empty), only run exact matches.
  const allow = cfg().fixPostFixCommandsAllowlist;
  const allowList = Array.isArray(allow) ? allow.filter(Boolean).map((s) => String(s).trim()) : [];
  const isAllowed = (cmd) => {
    const t = String(cmd || '').trim();
    if (!allowList.length) return true;
    return allowList.includes(t);
  };

  const parseStatusPaths = (porcelain) => {
    try {
      const out = [];
      const seen = new Set();
      const lines = String(porcelain || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n');
      for (const raw of lines) {
        const line = String(raw || '');
        if (!line.trim()) continue;
        // Format: XY <path>  OR  XY <old> -> <new>
        // We keep it intentionally simple: take the "new" path if rename, else the single path.
        const rest = line.length >= 4 ? line.slice(3) : line;
        let p = rest.includes('->') ? rest.split('->').slice(-1)[0] : rest;
        p = String(p || '').trim();
        if (!p) continue;
        // Filter obvious non-project noise.
        if (p.startsWith('.dev-healer/')) continue;
        if (p.startsWith('node_modules/')) continue;
        if (p.startsWith('dist/')) continue;
        if (p.startsWith('build/')) continue;
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
      return out;
    } catch {
      return [];
    }
  };

  for (const cmdText of list) {
    const normalized = String(cmdText || '').trim();
    if (!isAllowed(normalized)) {
      throw new Error(
        `post-fix command blocked by allowlist: ${normalized}\n\nAllowlisted commands:\n- ${allowList.join('\n- ')}`
      );
    }

    // Special case: `npm run format:check` defaults to `prettier . --check` which fails on repos with pre-existing
    // formatting drift (and is slow/noisy). Instead, only check files changed by the patch.
    if (/^npm\s+run\s+format:check(\s|$)/i.test(normalized)) {
      const st = await gitCapture(cwd, ['status', '--porcelain']);
      const changed = parseStatusPaths(st.stdout || '');
      if (!changed.length) continue;

      const stepLabel = `prettier --check (changed files: ${changed.length})`;
      if (root && logPath) appendFixLog(root, logPath, `[step] post-fix: ${stepLabel}`);

      const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      const res = await spawnWithStreaming({
        command: npx,
        args: ['--no-install', 'prettier', '--check', ...changed],
        cwd,
        shell: false,
        env: process.env,
        onStdout: (s) => root && logPath && appendFixText(root, logPath, s),
        onStderr: (s) => root && logPath && appendFixText(root, logPath, s),
      });
      if (res.code !== 0) {
        // Auto-repair: if formatting is the only thing failing, write-format the changed files and re-check once.
        // This makes format:check a "guard" without causing endless retries on trivial Prettier diffs.
        const writeLabel = `prettier --write (changed files: ${changed.length})`;
        if (root && logPath) appendFixLog(root, logPath, `[step] post-fix: ${writeLabel}`);
        const write = await spawnWithStreaming({
          command: npx,
          args: ['--no-install', 'prettier', '--write', ...changed],
          cwd,
          shell: false,
          env: process.env,
          onStdout: (s) => root && logPath && appendFixText(root, logPath, s),
          onStderr: (s) => root && logPath && appendFixText(root, logPath, s),
        });
        if (write.code !== 0) {
          throw new Error(
            `post-fix command failed: ${writeLabel}\nexit: ${write.code}\n\nstderr:\n${String(write.stderr || '').slice(-8000)}\n\nstdout:\n${String(write.stdout || '').slice(-8000)}`
          );
        }

        const recheckLabel = `prettier --check (after --write; changed files: ${changed.length})`;
        if (root && logPath) appendFixLog(root, logPath, `[step] post-fix: ${recheckLabel}`);
        const recheck = await spawnWithStreaming({
          command: npx,
          args: ['--no-install', 'prettier', '--check', ...changed],
          cwd,
          shell: false,
          env: process.env,
          onStdout: (s) => root && logPath && appendFixText(root, logPath, s),
          onStderr: (s) => root && logPath && appendFixText(root, logPath, s),
        });
        if (recheck.code !== 0) {
          throw new Error(
            `post-fix command failed: ${recheckLabel}\nexit: ${recheck.code}\n\nstderr:\n${String(recheck.stderr || '').slice(-8000)}\n\nstdout:\n${String(recheck.stdout || '').slice(-8000)}`
          );
        }
      }
      continue;
    }

    const { command, args, shell } = splitCommandShell(cmdText);
    if (root && logPath) appendFixLog(root, logPath, `[step] post-fix: ${cmdText}`);
    const res = await spawnWithStreaming({
      command,
      args,
      cwd,
      shell,
      env: process.env,
      onStdout: (s) => root && logPath && appendFixText(root, logPath, s),
      onStderr: (s) => root && logPath && appendFixText(root, logPath, s),
    });
    if (res.code !== 0) {
      throw new Error(
        `post-fix command failed: ${cmdText}\nexit: ${res.code}\n\nstderr:\n${String(res.stderr || '').slice(-8000)}\n\nstdout:\n${String(res.stdout || '').slice(-8000)}`
      );
    }
  }
}

async function commitAndPushIfConfigured({ cwd, root, logPath, id, title, sig, branch }) {
  if (!cfg().fixAutoCommit && !cfg().fixAutoPush) return;
  let committedSha = '';

  if (root && logPath) appendFixLog(root, logPath, `[step] git status`);
  const st = await gitCapture(cwd, ['status', '--porcelain']);
  if (st.code !== 0) throw new Error(`git status failed: ${st.code}\n\n${st.stderr}`);
  if (!String(st.stdout || '').trim()) {
    throw new Error('No changes detected after applying patch (nothing to commit).');
  }

  if (cfg().fixAutoCommit) {
    if (root && logPath) appendFixLog(root, logPath, `[step] git add -A`);
    const add = await gitCapture(cwd, ['add', '-A']);
    if (add.code !== 0) throw new Error(`git add failed: ${add.code}\n\n${add.stderr}`);

    const msg = formatCommitMessage({ id, title, sig });
    if (root && logPath) appendFixLog(root, logPath, `[step] git commit -m "${msg.replace(/"/g, '\\"')}"`);
    const commit = await gitCapture(cwd, ['commit', '-m', msg]);
    if (commit.code !== 0) {
      throw new Error(`git commit failed: ${commit.code}\n\nstderr:\n${commit.stderr}\n\nstdout:\n${commit.stdout}`);
    }
    const head = await gitCapture(cwd, ['rev-parse', 'HEAD']);
    if (head.code === 0) committedSha = String(head.stdout || '').trim();
  }

  if (cfg().fixAutoPush) {
    const remote = String(cfg().fixRemoteName || 'origin');
    if (root && logPath) appendFixLog(root, logPath, `[step] git push -u ${remote} ${branch}`);
    const push = await gitCapture(cwd, ['push', '-u', remote, branch]);
    if (push.code !== 0) {
      throw new Error(`git push failed: ${push.code}\n\nstderr:\n${push.stderr}\n\nstdout:\n${push.stdout}`);
    }
  }

  return { committedSha };
}

async function cherryPickToWorkspaceIfConfigured({ root, logPath, committedSha, id }) {
  // Important: failures in this "apply back to workspace" step should NOT cause fix attempts to retry.
  // The fix is already committed/pushed in the worktree branch; workspace-apply is best-effort.
  try {
    const enabled = cfg().fixCherryPickToWorkspaceOnSuccess !== false; // default true via package.json
    if (!enabled) return { applied: false, skipped: 'disabled' };
    const sha = String(committedSha || '').trim();
    if (!sha) return { applied: false, skipped: 'no-sha' };

    const strategy = String(cfg().fixCherryPickStrategy || 'stashAndPop');
    if (strategy === 'off') return { applied: false, skipped: 'strategy-off' };

    const st = await gitCapture(root, ['status', '--porcelain']);
    if (st.code !== 0) {
      if (root && logPath) appendFixLog(root, logPath, `[warn] git status failed; skipping workspace apply of ${sha}`);
      return { applied: false, skipped: 'git-status-failed' };
    }
    const dirty = Boolean(String(st.stdout || '').trim());

    const stashTopHash = async () => {
      const res = await gitCapture(root, ['stash', 'list', '-1', '--format=%H']);
      if (res.code !== 0) return '';
      return String(res.stdout || '').trim();
    };

    const safeCherryPick = async () => {
      if (root && logPath) appendFixLog(root, logPath, `[step] cherry-pick fix commit into workspace: git cherry-pick ${sha}`);
      const cpRes = await gitCapture(root, ['cherry-pick', sha]);
      if (cpRes.code !== 0) return { ok: false, cpRes };
      return { ok: true, cpRes };
    };

    const safeCherryPickAbort = async () => {
      const ab = await gitCapture(root, ['cherry-pick', '--abort']);
      return ab.code === 0;
    };

    const safeStashPop = async () => {
      if (root && logPath) appendFixLog(root, logPath, `[step] restore workspace changes: git stash pop`);
      const pop = await gitCapture(root, ['stash', 'pop']);
      return pop;
    };

    if (!dirty) {
      const cp = await safeCherryPick();
      if (!cp.ok) {
        if (root && logPath) {
          appendFixLog(
            root,
            logPath,
            `[warn] workspace cherry-pick failed (non-fatal): ${cp.cpRes.code}\n\nstderr:\n${cp.cpRes.stderr}\n\nstdout:\n${cp.cpRes.stdout}`
          );
        }
        return { applied: false, failed: 'cherry-pick' };
      }
      return { applied: true, strategy: 'clean' };
    }

    if (dirty && strategy === 'skipIfDirty') {
      if (root && logPath) appendFixLog(root, logPath, `[warn] workspace has local changes; skipping cherry-pick of ${sha}`);
      return { applied: false, skipped: 'dirty-worktree' };
    }

    // Strategy B (default): stash -> cherry-pick -> stash pop
    if (dirty && strategy === 'stashAndPop') {
      const beforeHash = await stashTopHash();
      const msg = `dev-healer-autostash${id ? ` ${id}` : ''} ${sha.slice(0, 12)} ${new Date().toISOString()}`;
      if (root && logPath) appendFixLog(root, logPath, `[step] stash local changes: git stash push -u -m "${msg.replace(/"/g, '\\"')}"`);
      const push = await gitCapture(root, ['stash', 'push', '-u', '-m', msg]);
      if (push.code !== 0) {
        if (root && logPath) appendFixLog(root, logPath, `[warn] git stash push failed; skipping workspace apply of ${sha} (non-fatal)`);
        return { applied: false, failed: 'stash-push' };
      }
      const afterHash = await stashTopHash();
      const created = Boolean(afterHash && afterHash !== beforeHash);

      const cp = await safeCherryPick();
      if (!cp.ok) {
        // Best effort: abort cherry-pick and restore stash.
        await safeCherryPickAbort();
        if (created) await safeStashPop();
        if (root && logPath) {
          appendFixLog(
            root,
            logPath,
            `[warn] workspace cherry-pick failed (non-fatal): ${cp.cpRes.code}\n\nstderr:\n${cp.cpRes.stderr}\n\nstdout:\n${cp.cpRes.stdout}`
          );
        }
        return { applied: false, failed: 'cherry-pick' };
      }

      if (created) {
        const pop = await safeStashPop();
        if (pop.code !== 0) {
          if (root && logPath) {
            appendFixLog(
              root,
              logPath,
              `[warn] stash pop had conflicts or failed (non-fatal). Your fix commit is applied, but your previous workspace changes may need manual conflict resolution.\n\nstderr:\n${pop.stderr}\n\nstdout:\n${pop.stdout}`
            );
          }
          await offerWorkspaceConflictHelp({
            root,
            logPath,
            title: 'Dev Healer',
            id,
            contextLabel: `Workspace apply: stash pop after cherry-pick ${sha.slice(0, 12)}`,
          });
        }
      }

      return { applied: true, strategy: 'stashAndPop' };
    }

    // Strategy C: apply to a new local branch (while preserving current dirty work via stash)
    if (dirty && strategy === 'newBranch') {
      const cur = await gitCapture(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const curBranch = cur.code === 0 ? String(cur.stdout || '').trim() : '';
      const beforeHash = await stashTopHash();
      const msg = `dev-healer-autostash(new-branch)${id ? ` ${id}` : ''} ${sha.slice(0, 12)} ${new Date().toISOString()}`;
      if (root && logPath) appendFixLog(root, logPath, `[step] stash local changes: git stash push -u -m "${msg.replace(/"/g, '\\"')}"`);
      const push = await gitCapture(root, ['stash', 'push', '-u', '-m', msg]);
      if (push.code !== 0) {
        if (root && logPath) appendFixLog(root, logPath, `[warn] git stash push failed; skipping workspace apply of ${sha} (non-fatal)`);
        return { applied: false, failed: 'stash-push' };
      }
      const afterHash = await stashTopHash();
      const created = Boolean(afterHash && afterHash !== beforeHash);

      let newBranch = `dev-healer/apply/${id || sha.slice(0, 12)}`;
      // avoid collisions
      const exists = await gitCapture(root, ['show-ref', '--verify', '--quiet', `refs/heads/${newBranch}`]);
      if (exists.code === 0) newBranch = `${newBranch}-${Date.now().toString(36)}`;

      if (root && logPath) appendFixLog(root, logPath, `[step] create branch: git switch -c ${newBranch}`);
      const sw = await gitCapture(root, ['switch', '-c', newBranch]);
      if (sw.code !== 0) {
        if (created) await safeStashPop();
        return { applied: false, failed: 'switch-branch' };
      }

      const cp = await safeCherryPick();
      if (!cp.ok) {
        await safeCherryPickAbort();
        // switch back then restore stash
        if (curBranch) await gitCapture(root, ['switch', curBranch]);
        if (created) await safeStashPop();
        if (root && logPath) {
          appendFixLog(
            root,
            logPath,
            `[warn] workspace cherry-pick to new branch failed (non-fatal): ${cp.cpRes.code}\n\nstderr:\n${cp.cpRes.stderr}\n\nstdout:\n${cp.cpRes.stdout}`
          );
        }
        return { applied: false, failed: 'cherry-pick' };
      }

      // Switch back to original branch and restore stash so user's current work continues unaffected.
      if (curBranch) {
        if (root && logPath) appendFixLog(root, logPath, `[step] return to original branch: git switch ${curBranch}`);
        await gitCapture(root, ['switch', curBranch]);
      }
      if (created) {
        const pop = await safeStashPop();
        if (pop.code !== 0 && root && logPath) {
          appendFixLog(
            root,
            logPath,
            `[warn] stash pop had conflicts or failed (non-fatal). The fix is on branch ${newBranch}; your current workspace changes may need manual conflict resolution.\n\nstderr:\n${pop.stderr}\n\nstdout:\n${pop.stdout}`
          );
        }
      }

      if (root && logPath) appendFixLog(root, logPath, `[info] fix commit applied to new local branch: ${newBranch}`);
      return { applied: false, strategy: 'newBranch', branch: newBranch };
    }

    // Fallback: behave like skipIfDirty.
    if (root && logPath) appendFixLog(root, logPath, `[warn] workspace has local changes; skipping cherry-pick of ${sha}`);
    return { applied: false, skipped: 'dirty-worktree' };
  } catch (e) {
    // Best-effort, never fail the overall fix run.
    if (root && logPath) appendFixLog(root, logPath, `[warn] workspace apply threw (non-fatal): ${String(e?.message || e)}`);
    return { applied: false, failed: 'exception' };
  }
}

function sendWatchedBrowserReloadIfConfigured() {
  try {
    const enabled = cfg().browserAutoReloadOnFixSuccess !== false; // default true via package.json
    if (!enabled) return false;
    if (!watchedBrowser?.terminal) return false;
    watchedBrowser.terminal.sendText('DEV_HEALER_BROWSER_CMD reload', true);
    return true;
  } catch {
    return false;
  }
}

function readTailLines(filePath, n = 200) {
  try {
    const abs = String(filePath || '');
    if (!abs || !fs.existsSync(abs)) return '';
    const txt = fs.readFileSync(abs, 'utf8');
    const lines = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    return lines.slice(Math.max(0, lines.length - Math.max(1, Number(n) || 200))).join('\n').trim();
  } catch {
    return '';
  }
}

function extractSearchTermsFromPrompt(promptText) {
  const s = String(promptText || '');
  const seen = new Set();
  const stop = new Set([
    'diff',
    'git',
    'index',
    '---',
    '+++',
    'import',
    'export',
    'default',
    'return',
    'const',
    'let',
    'var',
    'function',
    'class',
    'interface',
    'type',
    'extends',
    'implements',
    'async',
    'await',
    'true',
    'false',
    'null',
    'undefined',
    'string',
    'number',
    'boolean',
    'props',
    'state',
    'react',
    'node',
    'error',
    'errors',
    'runtime',
    'issue',
    'prompt',
    'context',
    'repo',
    'playbook',
  ]);

  const terms = [];
  const re = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;
  let m;
  while ((m = re.exec(s))) {
    const t = String(m[0]);
    const k = t.toLowerCase();
    if (stop.has(k)) continue;
    // Prefer identifiers that are likely to be meaningful: MixedCase, PascalCase, useHook, or contains underscores.
    const highSignal =
      /^[A-Z][A-Za-z0-9]+$/.test(t) || /^use[A-Z]/.test(t) || /[a-z][A-Z]/.test(t) || /_/.test(t);
    if (!highSignal) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    terms.push(t);
    if (terms.length >= 6) break;
  }
  return terms;
}

async function buildRepoSearchBlock({ cwd, promptText }) {
  try {
    const terms = extractSearchTermsFromPrompt(promptText).slice(0, 5);
    if (!terms.length) return '';

    const lines = [];
    lines.push('Repo search hints (via `git grep`):');
    lines.push('(Use these to anchor edits in the real code instead of rewriting files.)');
    lines.push('');

    for (const term of terms) {
      const res = await gitCapture(cwd, ['grep', '-n', '-m', '3', term, '--', 'src']);
      if (res.code !== 0 || !String(res.stdout || '').trim()) continue;
      lines.push(`--- git grep -n -m 3 "${term}" -- src ---`);
      const out = String(res.stdout || '')
        .trim()
        .split('\n')
        .slice(0, 6)
        .join('\n');
      lines.push(out);
      lines.push('');
    }

    const text = lines.join('\n').trim();
    return text ? text + '\n' : '';
  } catch {
    return '';
  }
}

function worktreeBaseDir(root) {
  return path.join(ensureDevHealerDir(root), 'worktrees');
}

function parseFixResultFromLogText(txt) {
  const s = String(txt || '');
  if (/\[result\]\s+success\b/i.test(s)) return 'success';
  if (/\[result\]\s+failed\b/i.test(s)) return 'failed';
  // Back-compat heuristic for older logs.
  if (/\[attempt\s+\d+\/\d+\]\s+success\b/i.test(s) && !/\bFix failed\b/i.test(s)) return 'success';
  return 'unknown';
}

function readTailText(p, maxBytes = 24_000) {
  try {
    const abs = String(p || '');
    if (!abs || !fs.existsSync(abs)) return '';
    const buf = fs.readFileSync(abs);
    if (!Buffer.isBuffer(buf)) return String(buf || '');
    const slice = buf.length > maxBytes ? buf.slice(buf.length - maxBytes) : buf;
    return slice.toString('utf8');
  } catch {
    return '';
  }
}

function listWorktreeDirs(root) {
  try {
    const base = worktreeBaseDir(root);
    if (!fs.existsSync(base)) return [];
    const entries = fs.readdirSync(base, { withFileTypes: true });
    return entries
      .filter((e) => e && e.isDirectory())
      .map((e) => path.join(base, e.name));
  } catch {
    return [];
  }
}

async function removeWorktreeDir({ root, dir, logPath }) {
  try {
    const resolvedRoot = path.resolve(root);
    const resolvedDir = path.resolve(dir);
    const expectedPrefix = path.resolve(worktreeBaseDir(root)) + path.sep;
    if (!resolvedDir.startsWith(expectedPrefix)) return;
    if (root && logPath) appendFixLog(root, logPath, `[cleanup] removing worktree: ${resolvedDir}`);
    await gitCapture(resolvedRoot, ['worktree', 'remove', '-f', resolvedDir]);
    try {
      fs.rmSync(resolvedDir, { recursive: true, force: true });
    } catch {}
    if (root && logPath) appendFixLog(root, logPath, `[cleanup] worktree removed: ${path.basename(resolvedDir)}`);
  } catch (e) {
    try {
      if (root && logPath) appendFixLog(root, logPath, `[cleanup] warning: failed to remove worktree ${String(dir || '')}`);
      if (root && logPath) appendFixLog(root, logPath, String(e?.message || e));
    } catch {}
  }
}

async function pruneOldFailedWorktrees({ root, keepN = 2, protect = new Set(), logPath }) {
  try {
    const base = worktreeBaseDir(root);
    const dirs = listWorktreeDirs(root);
    if (!dirs.length) return;

    const candidates = [];
    for (const dir of dirs) {
      const bn = path.basename(dir);
      const isProtected = protect && protect.has(dir);
      if (isProtected) continue;

      // Match worktree dir name to fix log name: safeWorktreeName(id) is the dir,
      // and the log file is `.dev-healer/fix-logs/<id>.log` (id includes prefix `dh_...`).
      // We don't have a reverse mapping reliably, so use a heuristic:
      // - if there's an issue log file whose name contains the worktree basename, use it.
      const logsDir = path.join(ensureDevHealerDir(root), 'fix-logs');
      let result = 'unknown';
      let logMtime = 0;
      try {
        if (fs.existsSync(logsDir)) {
          const logFiles = fs
            .readdirSync(logsDir)
            .filter((f) => f.endsWith('.log') && f.toLowerCase().includes(bn.toLowerCase()))
            .map((f) => path.join(logsDir, f));
          if (logFiles.length) {
            // Choose newest matching log.
            logFiles.sort((a, b) => {
              const am = fs.statSync(a).mtimeMs || 0;
              const bm = fs.statSync(b).mtimeMs || 0;
              return bm - am;
            });
            const p = logFiles[0];
            const st = fs.statSync(p);
            logMtime = st.mtimeMs || 0;
            result = parseFixResultFromLogText(readTailText(p));
          }
        }
      } catch {
        // ignore
      }

      if (result === 'failed') {
        let m = 0;
        try {
          m = fs.statSync(dir).mtimeMs || 0;
        } catch {}
        candidates.push({ dir, score: Math.max(m, logMtime) });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const toRemove = candidates.slice(Math.max(0, Number(keepN) || 0));
    for (const c of toRemove) {
      await removeWorktreeDir({ root, dir: c.dir, logPath });
    }

    // Final prune to keep git metadata tidy.
    await gitCapture(path.resolve(root), ['worktree', 'prune']);
  } catch {
    // ignore
  }
}

async function cleanupWorktreeIfConfigured({ root, worktreePath, logPath, outcome }) {
  try {
    if (!root || !worktreePath) return;
    if (!cfg().fixUseWorktrees) return;
    if (!cfg().fixCleanupWorktrees) return;

    const resolvedRoot = path.resolve(root);
    const resolvedWorktree = path.resolve(worktreePath);
    if (resolvedWorktree === resolvedRoot) return;

    const expectedPrefix = path.resolve(path.join(ensureDevHealerDir(root), 'worktrees')) + path.sep;
    if (!resolvedWorktree.startsWith(expectedPrefix)) return;

    const out = String(outcome || '').toLowerCase();
    if (out === 'success') {
      const keep = Math.max(0, Number(cfg().fixWorktreeRetainOnSuccess ?? 0) || 0);
      if (keep <= 0) {
        await removeWorktreeDir({ root: resolvedRoot, dir: resolvedWorktree, logPath });
      }
      return;
    }

    if (out === 'failed') {
      // Keep this failed worktree, but prune older failed worktrees beyond retention count.
      const keep = Math.max(0, Number(cfg().fixWorktreeRetainOnFailure ?? 2) || 0);
      if (keep <= 0) {
        await removeWorktreeDir({ root: resolvedRoot, dir: resolvedWorktree, logPath });
        return;
      }
      await pruneOldFailedWorktrees({ root: resolvedRoot, keepN: keep, protect: new Set([resolvedWorktree]), logPath });
      return;
    }
  } catch (e) {
    try {
      if (root && logPath) appendFixLog(root, logPath, `[cleanup] warning: failed to cleanup worktree`);
      if (root && logPath) appendFixLog(root, logPath, String(e?.message || e));
    } catch {}
  }
}

async function runFixPipelineForIssue({ id, title, promptText, source, sig, excerpt, kind }) {
  const root = workspaceRoot();
  if (!root) throw new Error('No workspace folder open');

  const maxAttempts = Math.max(1, Number(cfg().fixMaxAttemptsPerIssue || 3));
  const baseRefRes = await gitCapture(root, ['rev-parse', 'HEAD']);
  if (baseRefRes.code !== 0) throw new Error(`git rev-parse HEAD failed: ${baseRefRes.code}\n\n${baseRefRes.stderr}`);
  const baseRef = String(baseRefRes.stdout || '').trim();

  const branch = `${String(cfg().fixBranchPrefix || 'dev-healer/').trim()}${safeWorktreeName(id)}`;
  const logPath = writeArtifact(root, 'fix-logs', `${id}.log`, '');
  lastFixLogPath = logPath;

  // Preflight logging: ensure "Open Fix Log" never opens a blank file even if worktree setup fails.
  appendFixLog(root, logPath, `=== Dev Healer Fix Preflight ===`);
  appendFixLog(root, logPath, `Title: ${title}`);
  appendFixLog(root, logPath, `Issue ID: ${id}`);
  appendFixLog(root, logPath, `Base ref: ${baseRef}`);
  appendFixLog(root, logPath, `Branch: ${branch}`);
  appendFixLog(root, logPath, `Worktrees enabled: ${Boolean(cfg().fixUseWorktrees)}`);
  appendFixLog(root, logPath, `Started: ${new Date().toISOString()}`);
  appendFixLog(root, logPath, ``);

  let effectiveCwd = root;
  try {
    effectiveCwd = cfg().fixUseWorktrees ? await ensureWorktreeForIssue(root, { id, baseRef, branch }) : root;
  } catch (e) {
    appendFixLog(root, logPath, `[preflight] failed to prepare worktree`);
    appendFixLog(root, logPath, String(e?.stack || e));
    appendFixLog(root, logPath, ``);
    throw e;
  }

  let lastErr = null;
  // If we have the raw excerpt + kind, rebuild the prompt per-attempt inside the worktree so the
  // file excerpts match what git apply will see. (This prevents "patch does not apply" due to
  // workspace vs worktree drift/uncommitted edits.)
  let ptxt = String(promptText || '');
  const hasExcerpt = typeof excerpt === 'string' && excerpt.trim();
  const promptKind = String(kind || '').trim();
  let agentOverrides = null;

  const runner = async (progress) => {
    if (cfg().fixRevealOutputOnStart) {
      try {
        getFixOutput().show(true);
      } catch {}
    }
    if (cfg().fixOpenTailTerminal && logPath) openTailTerminalForLog(logPath);

    setStatus('$(sync~spin) Dev Healer: fixing', `Queue: ${fixQueue.length} queued\nActive: ${id}`);

    appendFixLog(root, logPath, `=== Dev Healer Fix Start ===`);
    appendFixLog(root, logPath, `Title: ${title}`);
    appendFixLog(root, logPath, `Issue ID: ${id}`);
    appendFixLog(root, logPath, `Source: ${source}`);
    appendFixLog(root, logPath, `Signature: ${sig}`);
    appendFixLog(root, logPath, `Max attempts (per issue): ${maxAttempts}`);
    appendFixLog(root, logPath, `Base ref: ${baseRef}`);
    appendFixLog(root, logPath, `Workdir: ${effectiveCwd}`);
    appendFixLog(root, logPath, `Branch: ${branch}`);
    appendFixLog(root, logPath, `Started: ${new Date().toISOString()}`);
    appendFixLog(root, logPath, ``);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        progress?.report?.({ message: `Issue ${id}: attempt ${attempt}/${maxAttempts}` });
        appendIssueLog(root, { id, at: new Date().toISOString(), source, sig, attempt, outcome: 'attempt_start', branch, baseRef });
        appendFixLog(root, logPath, `[attempt ${attempt}/${maxAttempts}] starting`);

        if (cfg().fixUseWorktrees) {
          // Reset to the base commit each attempt so retries are deterministic and don't accumulate partial changes.
          const r1 = await gitCapture(effectiveCwd, ['reset', '--hard', baseRef]);
          const r2 = await gitCapture(effectiveCwd, ['clean', '-fd']);
          if (r1.code !== 0 || r2.code !== 0) throw new Error(`failed to reset worktree to base ref ${baseRef}`);
        }

        // Build (or rebuild) the base prompt for this attempt in the effective worktree.
        // Note: if we don't have `excerpt`, fall back to the already-materialized promptText.
        const basePrompt = hasExcerpt
          ? buildFixPrompt(excerpt, promptKind || 'runtime', { fileRoot: effectiveCwd })
          : ptxt;

        // Persist the attempt prompt to disk for debugging.
        try {
          if (root) writeArtifact(root, 'prompts', `${id}.txt`, basePrompt);
        } catch {
          // ignore
        }

        const snapshot = await buildRepoSnapshotBlock({ cwd: effectiveCwd, root, promptText: basePrompt, baseRef });
        const grepBlock = await buildRepoSearchBlock({ cwd: effectiveCwd, promptText: basePrompt });
        const attemptPrompt = [basePrompt, snapshot, grepBlock].filter(Boolean).join('\n\n');
        if (snapshot) appendFixLog(root, logPath, `[info] repo snapshot appended to agent prompt (attempt ${attempt})`);
        if (grepBlock) appendFixLog(root, logPath, `[info] git grep hints appended to agent prompt (attempt ${attempt})`);

        await runPatchCommand(attemptPrompt, { id, title, logPath, progress, attempt, cwd: effectiveCwd, agentOverrides });
        await runPostFixCommands({ cwd: effectiveCwd, root, logPath });
        const commitRes = await commitAndPushIfConfigured({ cwd: effectiveCwd, root, logPath, id, title, sig, branch });

        // If we ran in a worktree, optionally apply the successful commit back onto the user's current branch
        // so the dev server/browser reflect the fix immediately.
        if (cfg().fixUseWorktrees) {
          const sha = String(commitRes?.committedSha || '').trim();
          if (sha) {
            const cp = await cherryPickToWorkspaceIfConfigured({ root, logPath, committedSha: sha, id });
            if (cp?.applied) {
              const reloaded = sendWatchedBrowserReloadIfConfigured();
              if (reloaded) appendFixLog(root, logPath, `[info] watched browser reload triggered`);
            }
          }
        }

        appendFixLog(root, logPath, `[attempt ${attempt}/${maxAttempts}] success`);
        appendIssueLog(root, { id, at: new Date().toISOString(), source, sig, attempt, outcome: 'pushed', branch });
        return { branch, workdir: effectiveCwd };
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e);
        appendFixLog(root, logPath, `[attempt ${attempt}/${maxAttempts}] failed: ${msg}`);
        writeArtifact(root, 'errors', `${id}.attempt-${attempt}.txt`, String(e?.stack || e?.message || e));
        appendIssueLog(root, { id, at: new Date().toISOString(), source, sig, attempt, outcome: 'failed', error: msg, branch });

        // Auth failures are not retriable; bail immediately with an actionable message.
        // (This often happens in worktree mode when `.env(.local)` is gitignored and wasn't loaded.)
        if (isAuthFailureMessage(msg)) {
          throw new Error(
            [
              'Cursor Agent authentication required.',
              'Fix options:',
              '- Ensure CURSOR_API_KEY is present in the workspace root `.env.local`/`.env`, or',
              '- Run: cursor agent login',
            ].join('\n')
          );
        }

        // If the diff is malformed/corrupt, force the agent into the most reliable mode on next attempt.
        // This avoids burning attempts on stream-json partial reconstruction + agent "handwritten" hunks.
        if (/corrupt patch/i.test(msg) || /invalid hunk ranges/i.test(msg) || /Patch appears malformed/i.test(msg)) {
          agentOverrides = { streamPartial: false, explainMode: 'none' };
          ptxt = [
            hasExcerpt ? buildFixPrompt(excerpt, promptKind || 'runtime', { fileRoot: effectiveCwd }) : ptxt,
            '',
            'IMPORTANT: Your previous output was malformed / could not be converted into an applyable patch.',
            'You MUST output valid edits JSON between BEGIN_DEV_HEALER_EDITS_JSON and END_DEV_HEALER_EDITS_JSON.',
            'Your "find" strings must match the provided excerpts exactly.',
            '',
          ].join('\n');
          appendFixLog(root, logPath, `[attempt ${attempt}/${maxAttempts}] forcing non-streaming agent output for next attempt (more reliable diff)`); 
        }

        // If the patch is well-formed but doesn't apply, it usually means the agent fabricated a diff
        // or rewrote files against a stale/incorrect version. Tighten constraints aggressively.
        if (/patch does not apply/i.test(msg) || /already exists in working directory/i.test(msg) || /patch failed:/i.test(msg)) {
          agentOverrides = { streamPartial: false, explainMode: 'none' };
          ptxt = [
            hasExcerpt ? buildFixPrompt(excerpt, promptKind || 'runtime', { fileRoot: effectiveCwd }) : ptxt,
            '',
            'IMPORTANT: Your previous output did not produce an applyable patch for the current files.',
            'This means you likely used a stale/incorrect snippet or proposed a too-large rewrite.',
            '',
            'Rules for the next attempt:',
            '- Make the smallest possible targeted edits (brownfield-safe). NO large refactors.',
            '- Do NOT rewrite entire files.',
            '- Do NOT add files that already exist; if a file exists, modify it instead.',
            '- Output ONLY valid edits JSON between BEGIN_DEV_HEALER_EDITS_JSON and END_DEV_HEALER_EDITS_JSON.',
            '',
          ].join('\n');
          appendFixLog(root, logPath, `[attempt ${attempt}/${maxAttempts}] forcing strict minimal-diff mode due to non-applying patch`);
        }

        if (attempt < maxAttempts) {
          // If checks failed, include a tail of the fix log so the agent sees the real compiler/lint/test output.
          // (The agent otherwise tends to guess.)
          let checksTail = '';
          if (/post-fix command failed:/i.test(msg)) {
            checksTail = readTailLines(logPath, 220);
          }
          const failureDetails = msg
            .split('\n')
            .map((l) => `>> ${l}`)
            .join('\n');
          ptxt = [
            ptxt,
            '',
            'Previous attempt failed. You MUST output a new unified diff that applies cleanly and makes all checks/commit/push succeed.',
            'Failure details:',
            failureDetails,
            checksTail
              ? [
                  '',
                  'Last attempt fix log excerpt (tail):',
                  checksTail
                    .split('\n')
                    .slice(0, 240)
                    .map((l) => `>> ${l}`)
                    .join('\n'),
                ].join('\n')
              : '',
            '',
          ].join('\n');
          appendFixLog(root, logPath, `[attempt ${attempt}/${maxAttempts}] retrying with failure details appended`);
        }
      }
    }
    throw lastErr || new Error('Fix failed');
  };

  let didSucceed = false;
  try {
    if (cfg().fixShowProgress) {
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: title, cancellable: false }, runner);
      didSucceed = true;
      return res;
    }
    const res = await runner(null);
    didSucceed = true;
    return res;
  } finally {
    setStatus('Dev Healer: idle', 'Dev Healer is running.');
    appendFixLog(root, logPath, ``);
    appendFixLog(root, logPath, `=== Dev Healer Fix End ===`);

    // Leave a breadcrumb indicating overall outcome (useful when scanning logs).
    const outcome = didSucceed ? 'success' : 'failed';
    try {
      appendFixLog(root, logPath, `[result] ${outcome}`);
    } catch {}

    // Cleanup policy:
    // - success: delete worktree (keep 0)
    // - failure: keep latest N failed worktrees for debugging (default 2)
    await cleanupWorktreeIfConfigured({ root, worktreePath: effectiveCwd, logPath, outcome });
  }
}

async function enqueueFix({ id, title, promptText, source, sig, excerpt, kind }) {
  const root = workspaceRoot();
  if (!root) throw new Error('No workspace folder open');
  fixQueue.push({ id, title, promptText, excerpt, kind, source, sig, enqueuedAt: new Date().toISOString() });

  const queued = fixQueue.length;
  // Avoid confusing "queued" + "failed" toasts at the same time when we start immediately.
  const shouldSayQueued = fixQueueRunning || queued > 1;
  vscode.window.showInformationMessage(
    shouldSayQueued ? `Dev Healer: queued fix (${queued} queued). Issue: ${id}` : `Dev Healer: starting fix. Issue: ${id}`
  );
  if (!fixQueueRunning) {
    void processFixQueue();
  }
}

async function rerunLastFixFromSavedPrompt() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showInformationMessage('Dev Healer: No workspace folder open.');
    return;
  }

  const last = readLatestIssueFromLog(root);
  if (!last?.id) {
    vscode.window.showInformationMessage('Dev Healer: No previous issue found to rerun yet.');
    return;
  }

  const promptPath = path.join(ensureDevHealerDir(root), 'prompts', `${last.id}.txt`);
  if (!fs.existsSync(promptPath)) {
    vscode.window.showErrorMessage(
      `Dev Healer: Could not find saved prompt for ${last.id}. You may need to reproduce the issue (manual report) again.`
    );
    return;
  }

  let promptText = '';
  try {
    promptText = fs.readFileSync(promptPath, 'utf8');
  } catch (e) {
    vscode.window.showErrorMessage(`Dev Healer: Failed reading saved prompt: ${String(e?.message || e)}`);
    return;
  }

  // IMPORTANT:
  // - We reuse the exact saved prompt text (so you don't redo manual steps).
  // - We create a new issue id so we don't overwrite artifacts/worktrees/logs for the previous run.
  const id = newIssueId();
  const sig = String(last.sig || '').slice(0, 300);
  const source = String(last.source || 'unknown');
  const inferredKind = String(last.type || '').toLowerCase() === 'manual-report' ? 'manual-ui' : 'runtime';
  const title = `Dev Healer: Rerun (${last.id})`;

  try {
    appendIssueLog(root, { id, at: new Date().toISOString(), source, type: 'rerun', sig, rerunOf: last.id });
    writeArtifact(root, 'prompts', `${id}.txt`, promptText);
  } catch {
    // ignore
  }

  try {
    await enqueueFix({
      id,
      title,
      excerpt: `Rerun of ${last.id}\n\n${sig}`,
      kind: inferredKind,
      promptText,
      source,
      sig,
    });
    vscode.window.showInformationMessage(`Dev Healer: rerun queued. Issue: ${id} (from ${last.id})`);
  } catch (e) {
    vscode.window.showErrorMessage(`Dev Healer: could not queue rerun. ${String(e?.message || e)}`);
  }
}

async function processFixQueue() {
  if (fixQueueRunning) return;
  if (!cfg().fixQueueEnabled) return;
  fixQueueRunning = true;
  try {
    while (fixQueue.length) {
      const next = fixQueue.shift();
      if (!next) continue;
      fixQueueActiveId = next.id;
      try {
        await showAuthHintOnce();
        const res = await runFixPipelineForIssue(next);
        vscode.window.showInformationMessage(`Dev Healer: pushed ${res.branch} for ${next.id}.`);
      } catch (e) {
        const root = workspaceRoot();
        const msg = String(e?.message || e);
        if (root) writeArtifact(root, 'errors', `${next.id}.final.txt`, String(e?.stack || e));

        // HIL after max attempts for this *same issue*.
        const isAuth = isAuthFailureMessage(msg);
        const actions = isAuth ? ['Login', 'Open fix log'] : ['Open fix log', 'Retry issue', 'Skip'];
        const message = isAuth
          ? 'Dev Healer: Cursor Agent is not authenticated.'
          : `${next.title || 'Dev Healer: Fix failed.'}`;
        const detail = isAuth
          ? "To run automated fixes, authenticate Cursor Agent (or set CURSOR_API_KEY).\n\nClick Login to run: cursor agent login\n\n(Details are in the fix log.)"
          : msg;
        const choice = await vscode.window.showErrorMessage(message, { modal: false, detail }, ...actions);
        if (choice === 'Login') {
          // Open an interactive terminal to let the user complete auth.
          const t = vscode.window.createTerminal({ name: 'Dev Healer: Cursor Agent Login' });
          t.show(true);
          // Support both variants depending on the installed CLI.
          t.sendText('cursor agent login || cursor-agent login', true);
          // Requeue and stop processing; everything depends on auth.
          fixQueue.unshift(next);
          // After login completes, the queue would otherwise stay paused until another issue is enqueued.
          // Schedule a resume attempt.
          setTimeout(() => {
            try {
              void processFixQueue();
            } catch {
              // ignore
            }
          }, 15000);
          break;
        }
        if (choice === 'Open fix log') {
          const p = root ? path.join(ensureDevHealerDir(root), 'fix-logs', `${next.id}.log`) : null;
          await openFileInEditor(p);
          // keep prompting HIL
          fixQueue.unshift(next);
          continue;
        }
        if (choice === 'Retry issue') {
          fixQueue.unshift(next);
          continue;
        }
        // Skip: do nothing
      } finally {
        fixQueueActiveId = null;
      }
    }
  } finally {
    fixQueueRunning = false;
    fixQueueActiveId = null;
  }
}

function appendFixLog(root, logPath, line) {
  const msg = String(line || '').replace(/\r?\n/g, '\n');
  try {
    if (root && logPath) fs.appendFileSync(logPath, msg.endsWith('\n') ? msg : msg + '\n', 'utf8');
  } catch {
    // ignore
  }
  try {
    getFixOutput().append(msg.endsWith('\n') ? msg : msg + '\n');
  } catch {
    // ignore
  }
}

function appendFixText(root, logPath, text) {
  // Raw streaming (no forced newline). Normalize carriage returns for readability.
  const msg = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!msg) return;
  try {
    if (root && logPath) fs.appendFileSync(logPath, msg, 'utf8');
  } catch {
    // ignore
  }
  try {
    getFixOutput().append(msg);
  } catch {
    // ignore
  }
}

function createFixLineWriter(root, logPath) {
  let buf = '';
  return {
    write: (chunk) => {
      if (!chunk) return;
      buf += String(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        appendFixLog(root, logPath, line);
      }
    },
    flush: () => {
      if (!buf) return;
      appendFixLog(root, logPath, buf);
      buf = '';
    },
  };
}

function createFixChunkWriter(root, logPath, { flushMs = 250, maxBuffer = 16_384 } = {}) {
  let buf = '';
  let timer = null;

  const flushNow = () => {
    if (!buf) return;
    appendFixText(root, logPath, buf);
    buf = '';
  };

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushNow();
    }, Math.max(25, Number(flushMs) || 250));
  };

  return {
    write: (chunk) => {
      if (!chunk) return;
      buf += String(chunk).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      if (buf.length >= maxBuffer) {
        if (timer) clearTimeout(timer);
        timer = null;
        flushNow();
        return;
      }
      schedule();
    },
    flush: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      flushNow();
    },
  };
}

function sanitizeUnifiedDiffPatch(patchText) {
  const raw = String(patchText || '');
  if (!raw) return { patch: raw, changed: false, fixedMissingPrefixes: 0, droppedNonDiffLines: 0 };

  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  let inHunk = false;
  let seenDiff = false;
  let fixedMissingPrefixes = 0;
  let fixedHunkHeaders = 0;
  let fixedHunkRanges = 0;
  let droppedNonDiffLines = 0;

  const isHeaderLine = (line) =>
    line.startsWith('diff --git ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ') ||
    line.startsWith('new file mode ') ||
    line.startsWith('deleted file mode ') ||
    line.startsWith('similarity index ') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('old mode ') ||
    line.startsWith('new mode ') ||
    line.startsWith('Binary files ') ||
    line.startsWith('GIT binary patch') ||
    line.startsWith('@@ ');

  // Track current hunk so we can repair incorrect hunk ranges (counts) produced by the agent.
  let hunkHeaderOutIdx = -1;
  let hunkOldCount = 0;
  let hunkNewCount = 0;

  const hunkHeaderRegex = /^@@\s+-([0-9]+)(?:,([0-9]+))?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@(.*)$/;
  const finalizeHunkIfNeeded = () => {
    if (hunkHeaderOutIdx < 0) return;
    const header = out[hunkHeaderOutIdx];
    const m = hunkHeaderRegex.exec(String(header || ''));
    if (!m) {
      // If we can't parse it, don't attempt to rewrite it.
      hunkHeaderOutIdx = -1;
      hunkOldCount = 0;
      hunkNewCount = 0;
      return;
    }
    const oldStart = Number(m[1]);
    const oldLenExpected = m[2] == null ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newLenExpected = m[4] == null ? 1 : Number(m[4]);
    const suffix = m[5] || '';

    // Only rewrite when counts don't match; keep the start lines as-is.
    if (oldLenExpected !== hunkOldCount || newLenExpected !== hunkNewCount) {
      const fmtLen = (n) => (n === 1 ? '' : `,${n}`);
      out[hunkHeaderOutIdx] = `@@ -${oldStart}${fmtLen(hunkOldCount)} +${newStart}${fmtLen(hunkNewCount)} @@${suffix}`;
      fixedHunkRanges++;
    }

    hunkHeaderOutIdx = -1;
    hunkOldCount = 0;
    hunkNewCount = 0;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Skip leading noise until the first diff header.
    if (!seenDiff) {
      if (line.startsWith('diff --git ')) {
        seenDiff = true;
      } else {
        continue;
      }
    }

    // diff header resets hunk state.
    if (line.startsWith('diff --git ')) {
      finalizeHunkIfNeeded();
      inHunk = false;
      out.push(line);
      continue;
    }

    // Hunk header must be emitted verbatim (never prefix it).
    if (line.startsWith('@@ ')) {
      finalizeHunkIfNeeded();
      inHunk = true;
      out.push(line);
      hunkHeaderOutIdx = out.length - 1;
      continue;
    }

    // Repair a common sanitizer/agent corruption: leading-space hunk headers (" @@ ...").
    if (line.startsWith(' @@') && line.trimStart().startsWith('@@ ')) {
      finalizeHunkIfNeeded();
      inHunk = true;
      out.push(line.trimStart());
      fixedHunkHeaders++;
      hunkHeaderOutIdx = out.length - 1;
      continue;
    }

    if (inHunk) {
      // In a hunk, every line must start with ' ', '+', '-', or '\'.
      // Cursor Agent sometimes forgets the leading space for context lines; repair it.
      if (line && !line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-') && !line.startsWith('\\')) {
        out.push(' ' + line);
        hunkOldCount += 1;
        hunkNewCount += 1;
        fixedMissingPrefixes++;
        continue;
      }
      out.push(line);
      if (line.startsWith('+')) hunkNewCount += 1;
      else if (line.startsWith('-')) hunkOldCount += 1;
      else if (line.startsWith(' ')) {
        hunkOldCount += 1;
        hunkNewCount += 1;
      }
      continue;
    }

    // Outside hunks, only allow known diff header lines; drop anything else (agent chatter).
    if (line === '' || isHeaderLine(line)) {
      out.push(line);
    } else {
      droppedNonDiffLines++;
    }
  }

  finalizeHunkIfNeeded();
  const patch = out.join('\n').trimEnd() + '\n';
  const changed = patch !== raw;
  return { patch, changed, fixedMissingPrefixes, fixedHunkHeaders, fixedHunkRanges, droppedNonDiffLines };
}

function openTailTerminalForLog(logPath) {
  try {
    if (!logPath) return;
    // Reuse a single tail terminal.
    if (!fixTailTerminal) {
      fixTailTerminal = vscode.window.createTerminal({ name: 'Dev Healer Fix (tail)' });
    }
    const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
    const cmd =
      process.platform === 'win32'
        ? `powershell -NoProfile -Command "Get-Content -Path ${q(logPath)} -Tail 200 -Wait"`
        : `tail -n 200 -f ${q(logPath)}`;
    fixTailTerminal.show(true);
    fixTailTerminal.sendText(`echo "Dev Healer: tailing ${logPath}"`, true);
    fixTailTerminal.sendText(cmd, true);
  } catch {
    // ignore
  }
}

function summarizeBrowserEvent(json) {
  if (!json) return { type: 'event', message: '', url: '' };
  const type = String(json.type || 'event');
  const msg = String(json.message || json.text || json.userExpectation || '').trim();
  const url = String(json.url || '').trim();
  const locationUrl = String(json?.location?.url || '').trim();
  return { type, message: msg, url, locationUrl };
}

function buildGroupedBrowserExcerpt({ events, tailLines }) {
  const lines = [];
  lines.push(`Grouped browser events: ${events.length}`);
  const byType = new Map();
  for (const e of events) byType.set(e.type, (byType.get(e.type) || 0) + 1);
  lines.push(`Types: ${Array.from(byType.entries()).map(([t, c]) => `${t}=${c}`).join(', ')}`);
  lines.push('');
  lines.push('Event summaries (most recent first):');
  for (const e of [...events].slice(-12).reverse()) {
    lines.push(`- ${e.type}: ${e.message?.slice(0, 260) || ''}${e.url ? ` (url: ${e.url})` : ''}`);
  }
  lines.push('');
  lines.push('Watched Browser excerpt:');
  lines.push(tailLines);
  return lines.join('\n');
}

function isAuthFailureMessage(msg) {
  const s = String(msg || '');
  if (!s) return false;
  return /Authentication required/i.test(s) || /cursor-agent login/i.test(s) || /\bcursor\s+agent\s+login\b/i.test(s);
}

async function getManualReportScreenshotOcrText({ root, id, screenshot, screenshotClip }) {
  if (!cfg().browserOcrOnManualReports) return '';
  const cmdText = String(cfg().visionOcrCommand || '').trim();
  if (!cmdText) return '';

  const paths = [screenshot, screenshotClip].filter(Boolean).map(String);
  const existing = paths.filter((p) => p && fs.existsSync(p));
  if (!existing.length) return '';

  const uncached = existing.filter((p) => !ocrCache.has(p));
  if (uncached.length) {
    try {
      const { command, args, shell } = splitCommandShell(cmdText);
      const fullArgs = [...args, '--max-lines', '60', '--min-confidence', '0.35', ...uncached];
      const res = await spawnWithInputCapture({
        command,
        args: fullArgs,
        cwd: root || workspaceRoot() || process.cwd(),
        shell,
        env: { ...process.env, DEV_HEALER_WORKSPACE_ROOT: root || workspaceRoot() || '' },
        input: '',
      });
      if (res.code === 0) {
        const parsed = safeJsonParse(String(res.stdout || '').trim(), []);
        if (Array.isArray(parsed)) {
          for (const r of parsed) {
            const p = String(r?.path || '');
            const txt = String(r?.text || '').trim();
            if (p && txt) ocrCache.set(p, txt);
          }
        }
      } else {
        // Best-effort: store OCR error for debugging, but don't fail the fix flow.
        if (root) writeArtifact(root, 'errors', `${id || 'manual-report'}.ocr.txt`, String(res.stderr || '').slice(-8000));
      }
    } catch (e) {
      if (root) writeArtifact(root, 'errors', `${id || 'manual-report'}.ocr.txt`, String(e?.stack || e?.message || e).slice(-8000));
    }
  }

  const merged = existing
    .map((p) => ocrCache.get(p))
    .filter(Boolean)
    .map((t) => String(t).trim())
    .filter(Boolean)
    .join('\n\n');

  if (!merged) return '';
  if (root && id) {
    try {
      writeArtifact(root, 'ocr', `${id}.txt`, merged + '\n');
    } catch {}
  }
  return merged;
}

async function showAuthHintOnce() {
  if (hasShownAuthHint) return;
  hasShownAuthHint = true;

  const root = workspaceRoot();
  if (!root) return;

  if (process.env.CURSOR_API_KEY && process.env.CURSOR_API_KEY.trim()) {
    vscode.window.showInformationMessage('Dev Healer: Fix will authenticate Cursor Agent using CURSOR_API_KEY from the extension environment.');
    return;
  }

  const present = envKeyPresence(root);
  if (present.found) {
    vscode.window.showInformationMessage(`Dev Healer: Fix will use CURSOR_API_KEY from ${present.file} (via tools/cursor-agent-patch.mjs).`);
  } else {
    vscode.window.showWarningMessage('Dev Healer: No CURSOR_API_KEY found in .env.local/.env. Fix will require `cursor agent login` or setting CURSOR_API_KEY.');
  }
}

async function startWatchedDev() {
  if (watched) {
    watched.terminal.show(true);
    return;
  }

  recent = [];
  lastSigAt = new Map();

  const { devCommand } = cfg();
  const effectiveDevCommand = ensureViteHostFlag(devCommand);

  watched = createWatchedTerminal({
    name: 'Dev (Watched)',
    commandText: effectiveDevCommand,
    // Ensure Vite binds to IPv4 as well as IPv6 when launched via Dev Healer.
    // Without this, some macOS setups will bind only to [::1], making 127.0.0.1 fail.
    // Also set PLAYWRIGHT=1 so Vite won't auto-open another browser window (see vite.config.ts `server.open`).
    env: { VITE_BIND_ALL: process.env.VITE_BIND_ALL ?? '1', PLAYWRIGHT: process.env.PLAYWRIGHT ?? '1' },
    onExit: () => {
      watched = null;
    },
    onLine: async (line) => {
    recent.push(line);
    if (recent.length > 200) recent.shift();

    if (!cfg().enabled) return;
    if (!looksLikeError(line)) return;

    const sig = line.trim();
    const root = workspaceRoot();
    if (root && isIgnored(root, { scope: 'vite', sig, type: 'vite' })) return;
    const now = Date.now();
    const last = lastSigAt.get(sig) ?? 0;
    if (now - last < cfg().errorCooldownMs) return;
    lastSigAt.set(sig, now);

    const id = newIssueId();
    const excerpt = recent.slice(-40).join('\n');
    const title = buildIssueTitle({ source: 'vite', sig });
    const choice = await vscode.window.showErrorMessage(
      title,
      { modal: false, detail: `Issue ID: ${id}\n\n${sig}` },
      'Fix',
      'Ignore always',
      'Ignore'
    );
    if (choice === 'Ignore always') {
      if (root) {
        addIgnoreRule(root, { scope: 'vite', type: 'vite', sigContains: sig.slice(0, 200) });
        vscode.window.showInformationMessage(`Dev Healer: Added ignore rule (vite) for: ${sig.slice(0, 120)}`);
      }
      return;
    }
    if (choice !== 'Fix') return;

      // One-time auth/path clarity before we attempt a fix.
      await showAuthHintOnce();

    try {
      if (root) {
        appendIssueLog(root, { id, at: new Date().toISOString(), source: 'vite', sig, excerpt });
        writeArtifact(root, 'prompts', `${id}.txt`, buildFixPrompt(excerpt));
      }

      await enqueueFix({ id, title, excerpt, kind: 'runtime', promptText: buildFixPrompt(excerpt), source: 'vite', sig });
    } catch (e) {
      const root = workspaceRoot();
      if (root) {
        writeArtifact(root, 'errors', `${id}.txt`, String(e?.stack || e?.message || e));
        appendIssueLog(root, { id, at: new Date().toISOString(), source: 'vite', outcome: 'fix_failed', error: String(e?.message || e) });
    }
      vscode.window.showErrorMessage(`Dev Healer: fix failed. ${e?.message || e}`);
    }
    },
  });

  watched.terminal.show(true);
}

function stopWatchedDev() {
  watched?.stop();
  watched = null;
}

async function startWatchedBrowser() {
  if (watchedBrowser) {
    watchedBrowser.terminal.show(true);
    return;
  }

  recentBrowser = [];
  lastBrowserSigAt = new Map();

  const { browserCommand, browserUrl } = cfg();

  watchedBrowser = createWatchedTerminal({
    name: 'Browser (Watched)',
    commandText: browserCommand,
    env: { DEV_HEALER_BROWSER_URL: browserUrl, DEV_HEALER_BROWSER_CAPTURE_MODE: String(cfg().browserCaptureMode || 'manual') },
    onExit: () => {
      watchedBrowser = null;
    },
    onLine: async (line) => {
    recentBrowser.push(line);
    if (recentBrowser.length > 300) recentBrowser.shift();

    if (!cfg().enabled) return;
    if (!looksLikeBrowserEvent(line)) return;

    let sig = line.trim();
    const json = parseBrowserEvent(line);
    if (json) sig = `${json.type || 'event'}:${json.message || json.text || json.userExpectation || ''}`.slice(0, 300);

    if (!shouldPromptForBrowserEvent(json, cfg().browserCaptureMode)) return;

    // In auto/both mode, suppress prompts while idle (unless user interacted recently).
    if (json?.type !== 'manual-report' && String(cfg().browserCaptureMode || 'both') !== 'manual') {
      const requireMs = Number(cfg().browserAutoRequireGestureMs || 0);
      const age = Number.isFinite(Number(json?.gestureAgeMs)) ? Number(json.gestureAgeMs) : null;
      if (requireMs > 0 && age !== null && age > requireMs) return;
    }

    const root = workspaceRoot();
    if (root) {
      const summary = summarizeBrowserEvent(json);
      if (
        isIgnored(root, {
          scope: 'browser',
          type: summary.type,
          sig,
          message: summary.message,
          url: summary.url,
          locationUrl: summary.locationUrl,
        })
      ) {
        return;
      }
    }

    const isManual = json?.type === 'manual-report';
    const mode = String(cfg().browserCaptureMode || 'both');

    // Manual reports: open a short session window and absorb nearby auto events into ONE prompt.
    if (isManual) {
      const groupWindowMs = Number(cfg().browserGroupWindowMs || 1500);
      if (!pendingManualSession) {
        const id = newIssueId();
        pendingManualSession = { id, sig: sig || 'manual-report', json, events: [], timer: null };
        pendingManualSession.timer = setTimeout(async () => {
          const session = pendingManualSession;
          pendingManualSession = null;
          if (!session) return;

          const id2 = session.id;
          const title = buildIssueTitle({ source: 'browser', json: session.json, sig: session.sig });
          const excerpt = recentBrowser.slice(-160).join('\n');
          const extra = (session.events || []).filter((e) => e && e.type !== 'manual-report');
          const groupedText = extra.length ? buildGroupedBrowserExcerpt({ events: extra, tailLines: excerpt }) : null;

          const choice = await vscode.window.showErrorMessage(
            title,
            { modal: false, detail: `Issue ID: ${id2}\n\n${session.sig}` },
            'Fix',
            'Ignore always',
            'Ignore'
          );
          if (choice === 'Ignore always') {
            const r = workspaceRoot();
            if (r) {
              addIgnoreRule(r, { scope: 'browser', sigContains: session.sig, type: 'manual-report' });
              vscode.window.showInformationMessage(`Dev Healer: Added ignore rule (browser) for manual reports matching: ${session.sig.slice(0, 120)}`);
            }
            return;
          }
          if (choice !== 'Fix') return;

          await showAuthHintOnce();

          const devExcerpt = recent.slice(-120).join('\n');
          let expectation = session.json?.userExpectation || '';
          let notes = session.json?.userNotes || '';
          const element = session.json?.element || null;

          const userExpectation = await vscode.window.showInputBox({
            title: `${title} 1/2: Expected behavior`,
            prompt: 'Describe what should have happened (press Enter to continue)',
            value: expectation || '',
            ignoreFocusOut: true,
          });
          if (typeof userExpectation === 'string' && userExpectation.trim()) expectation = userExpectation.trim();

          const next = await vscode.window.showQuickPick(['Skip notes', 'Add notes (optional)'], {
            title,
            placeHolder: 'Optional: add extra context (repro steps), or skip',
            ignoreFocusOut: true,
          });
          if (next === 'Add notes (optional)') {
            const userNotes = await vscode.window.showInputBox({
              title: `${title} 2/2: Extra notes (optional)`,
              prompt: 'Useful: repro steps, what you clicked, what you saw, constraints',
              value: notes || '',
              ignoreFocusOut: true,
            });
            if (typeof userNotes === 'string' && userNotes.trim()) notes = userNotes.trim();
          }

          const root2 = workspaceRoot();
          let ocrText = '';
          try {
            ocrText = await getManualReportScreenshotOcrText({
              root: root2,
              id: id2,
              screenshot: session.json?.screenshot || null,
              screenshotClip: session.json?.screenshotClip || null,
            });
          } catch {
            ocrText = '';
          }

          const combined = [
            `Issue ID: ${id2}`,
            expectation ? `User expectation: ${expectation}` : null,
            notes ? `User notes: ${notes}` : null,
            element ? `Element context: ${JSON.stringify(element)}` : null,
            session.json?.screenshot ? `Screenshot: ${session.json.screenshot}` : null,
            session.json?.screenshotClip ? `Screenshot (clip): ${session.json.screenshotClip}` : null,
            ocrText ? `\nScreenshot OCR:\n${ocrText}` : null,
            session.json?.trace ? `Trace: ${session.json.trace}` : null,
            groupedText ? groupedText : null,
            '',
            'Watched Browser excerpt:',
            excerpt,
            '',
            'Recent Vite excerpt:',
            devExcerpt || '(no recent Vite output captured yet)',
            '',
          ]
            .filter(Boolean)
            .join('\n');

          if (root2) {
            appendIssueLog(root2, {
              id: id2,
              at: new Date().toISOString(),
              source: 'browser',
              type: 'manual-report',
              sig: session.sig,
              url: session.json?.url || null,
              screenshot: session.json?.screenshot || null,
              screenshotClip: session.json?.screenshotClip || null,
              trace: session.json?.trace || null,
              expectation: expectation || '',
              notes: notes || '',
            });
            writeArtifact(root2, 'prompts', `${id2}.txt`, buildFixPrompt(combined, 'manual-ui'));
          }

          try {
            await enqueueFix({
              id: id2,
              title,
              excerpt: combined,
              kind: 'manual-ui',
              promptText: buildFixPrompt(combined, 'manual-ui'),
              source: 'browser',
              sig: session.sig,
            });
          } catch (e) {
            console.error('[dev-healer] enqueue failed', e);
            vscode.window.showErrorMessage(`Dev Healer: could not queue fix. ${e?.message || e}`);
          }
        }, Math.max(200, groupWindowMs));
      }

      try {
        pendingManualSession.events.push(summarizeBrowserEvent(json));
      } catch {
        // ignore
      }
      return;
    }

    // If a manual session is open, absorb auto events into it to avoid extra prompts.
    if (pendingManualSession) {
      try {
        pendingManualSession.events.push(summarizeBrowserEvent(json));
      } catch {
        // ignore
      }
      return;
    }

    // Auto/both can be grouped to prevent floods.
    if (mode !== 'manual') {
      const groupWindowMs = Number(cfg().browserGroupWindowMs || 1500);
      const group = pendingBrowserGroups.get(sig) || { firstAt: Date.now(), lastAt: Date.now(), events: [], timer: null };
      group.lastAt = Date.now();
      group.events.push(summarizeBrowserEvent(json));
      pendingBrowserGroups.set(sig, group);

      if (!group.timer) {
        group.timer = setTimeout(async () => {
          // flush
          pendingBrowserGroups.delete(sig);
          const now = Date.now();
          const last = lastBrowserSigAt.get(sig) ?? 0;
          if (now - last < cfg().errorCooldownMs) return;
          lastBrowserSigAt.set(sig, now);

          const excerpt = recentBrowser.slice(-120).join('\n');
          const groupedText = buildGroupedBrowserExcerpt({ events: group.events, tailLines: excerpt });
          const id = newIssueId();
          const title = buildIssueTitle({ source: 'browser', json, sig, count: group.events.length });
          const choice = await vscode.window.showErrorMessage(
            title,
            { modal: false, detail: `Issue ID: ${id}\n\n${sig}` },
            'Fix',
            'Ignore always',
            'Ignore'
          );
          if (choice === 'Ignore always') {
            const r = workspaceRoot();
            if (r) {
              addIgnoreRule(r, { scope: 'browser', sigContains: sig, type: 'grouped' });
              vscode.window.showInformationMessage(`Dev Healer: Added ignore rule (browser) for signature: ${sig.slice(0, 120)}`);
            }
            return;
          }
          if (choice !== 'Fix') return;

          await showAuthHintOnce();
          const devExcerpt = recent.slice(-120).join('\n');
          const combined = [
            `Issue ID: ${id}`,
            groupedText,
            '',
            'Recent Vite excerpt:',
            devExcerpt || '(no recent Vite output captured yet)',
            '',
          ].join('\n');

          const root = workspaceRoot();
          if (root) {
            appendIssueLog(root, {
              id,
              at: new Date().toISOString(),
              source: 'browser',
              type: 'grouped',
              sig,
              count: group.events.length,
            });
            writeArtifact(root, 'prompts', `${id}.txt`, buildFixPrompt(combined, 'runtime'));
          }

          try {
            await enqueueFix({ id, title, excerpt: combined, kind: 'runtime', promptText: buildFixPrompt(combined, 'runtime'), source: 'browser', sig });
          } catch (e) {
            console.error('[dev-healer] enqueue failed', e);
            vscode.window.showErrorMessage(`Dev Healer: could not queue fix. ${e?.message || e}`);
          }
        }, Math.max(200, groupWindowMs));
      }
      return;
    }

    // Not grouped: manual-report (or manual mode).
    const now = Date.now();
    const last = lastBrowserSigAt.get(sig) ?? 0;
    if (now - last < cfg().errorCooldownMs) return;
    lastBrowserSigAt.set(sig, now);

    const excerpt = recentBrowser.slice(-120).join('\n');

    const id = newIssueId();
    const title = buildIssueTitle({ source: 'browser', json, sig });
    const choice = await vscode.window.showErrorMessage(title, { modal: false, detail: `Issue ID: ${id}\n\n${sig}` }, 'Fix', 'Ignore always', 'Ignore');
    if (choice === 'Ignore always') {
      const r = workspaceRoot();
      if (r) {
        const summary = summarizeBrowserEvent(json);
        const rule =
          summary.locationUrl
            ? { scope: 'browser', type: summary.type, locationUrlContains: summary.locationUrl }
            : summary.message
              ? { scope: 'browser', type: summary.type, messageContains: summary.message.slice(0, 180) }
              : { scope: 'browser', sigContains: sig, type: summary.type };
        addIgnoreRule(r, rule);
        vscode.window.showInformationMessage(`Dev Healer: Added ignore rule (browser) for: ${(summary.locationUrl || summary.message || sig).slice(0, 120)}`);
      }
      return;
    }
    if (choice !== 'Fix') return;

    await showAuthHintOnce();

    // Include both the browser excerpt and the recent Vite excerpt (if available).
    const devExcerpt = recent.slice(-120).join('\n');
    let expectation = json?.type === 'manual-report' ? json?.userExpectation : '';
    let notes = json?.type === 'manual-report' ? json?.userNotes : '';
    const element = json?.type === 'manual-report' ? json?.element : null;

    // Notes are for repro steps + UI state + constraints; they help the agent target the right code path.
    if (json?.type === 'manual-report') {
      const userExpectation = await vscode.window.showInputBox({
        title: `Dev Healer (${id}) 1/2: Expected behavior`,
        prompt: 'Describe what should have happened (press Enter to continue)',
        value: expectation || '',
        ignoreFocusOut: true,
      });
      if (typeof userExpectation === 'string' && userExpectation.trim()) expectation = userExpectation.trim();

      const next = await vscode.window.showQuickPick(['Skip notes', 'Add notes (optional)'], {
        title: `Dev Healer (${id})`,
        placeHolder: 'Optional: add extra context (repro steps), or skip',
        ignoreFocusOut: true,
      });
      if (next === 'Add notes (optional)') {
        const userNotes = await vscode.window.showInputBox({
          title: `Dev Healer (${id}) 2/2: Extra notes (optional)`,
          prompt: 'Useful: repro steps, what you clicked, what you saw, constraints (e.g. must keep keyboard focus)',
          value: notes || '',
          ignoreFocusOut: true,
        });
        if (typeof userNotes === 'string' && userNotes.trim()) notes = userNotes.trim();
      }
    }

    const combined = [
      `Issue ID: ${id}`,
      expectation ? `User expectation: ${expectation}` : null,
      notes ? `User notes: ${notes}` : null,
      element ? `Element context: ${JSON.stringify(element)}` : null,
      json?.screenshot ? `Screenshot: ${json.screenshot}` : null,
      json?.screenshotClip ? `Screenshot (clip): ${json.screenshotClip}` : null,
      json?.trace ? `Trace: ${json.trace}` : null,
      null,
      'Watched Browser excerpt:',
      excerpt,
      '',
      'Recent Vite excerpt:',
      devExcerpt || '(no recent Vite output captured yet)',
      '',
      'Note: If the excerpt includes screenshot/trace paths under .dev-healer/, you can inspect them locally.',
    ]
      .filter(Boolean)
      .join('\n');

    if (root) {
      appendIssueLog(root, {
        id,
        at: new Date().toISOString(),
        source: 'browser',
        type: json?.type || 'event',
        sig,
        url: json?.url || null,
        screenshot: json?.screenshot || null,
        screenshotClip: json?.screenshotClip || null,
        trace: json?.trace || null,
        expectation: expectation || '',
        notes: notes || '',
      });
      writeArtifact(root, 'prompts', `${id}.txt`, buildFixPrompt(combined, json?.type === 'manual-report' ? 'manual-ui' : 'runtime'));
    }

    try {
      await enqueueFix({
        id,
        title,
        excerpt: combined,
        kind: json?.type === 'manual-report' ? 'manual-ui' : 'runtime',
        promptText: buildFixPrompt(combined, json?.type === 'manual-report' ? 'manual-ui' : 'runtime'),
        source: 'browser',
        sig,
      });
    } catch (e) {
      console.error('[dev-healer] enqueue failed', e);
      vscode.window.showErrorMessage(`Dev Healer: could not queue fix. ${e?.message || e}`);
    }
    },
  });

  watchedBrowser.terminal.show(true);
  vscode.window.showInformationMessage('Watched Browser started. Use the Chromium window it opens; errors will prompt Fix/Ignore.');
}

function stopWatchedBrowser() {
  watchedBrowser?.stop();
  watchedBrowser = null;
}

async function reloadWatchedBrowser() {
  try {
    if (!watchedBrowser?.terminal) {
      vscode.window.showInformationMessage('Dev Healer: Watched browser is not running.');
      return;
    }
    watchedBrowser.terminal.show(true);
    watchedBrowser.terminal.sendText('DEV_HEALER_BROWSER_CMD reload', true);
    vscode.window.showInformationMessage('Dev Healer: Reload sent to watched browser.');
  } catch (e) {
    vscode.window.showErrorMessage(`Dev Healer: Failed to reload watched browser: ${String(e?.message || e)}`);
  }
}

async function openWorkspaceApplyConflicts() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showInformationMessage('Dev Healer: No workspace folder open.');
    return;
  }
  const files = await listUnmergedPaths(root);
  if (!files.length) {
    vscode.window.showInformationMessage('Dev Healer: No unmerged conflict files detected.');
    return;
  }
  await openWorkspaceFiles({ root, relPaths: files, preserveFocus: false, maxFiles: 12 });
  vscode.window.showWarningMessage(`Dev Healer: Opened ${Math.min(files.length, 12)} conflicted file(s). Resolve markers then run git add.`, {
    modal: false,
  });
}

async function stageResolvedWorkspaceConflicts() {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showInformationMessage('Dev Healer: No workspace folder open.');
    return;
  }
  const files = await listUnmergedPaths(root);
  if (files.length) {
    vscode.window.showWarningMessage(
      `Dev Healer: ${files.length} conflicted file(s) still unmerged. Resolve them first, then try "Stage Resolved Workspace Conflicts" again.`,
      { modal: false }
    );
    return;
  }
  const add = await gitCapture(root, ['add', '-A']);
  if (add.code !== 0) {
    vscode.window.showErrorMessage(`Dev Healer: git add -A failed: ${add.code}\n\n${add.stderr || add.stdout || ''}`);
    return;
  }
  vscode.window.showInformationMessage('Dev Healer: Staged changes (git add -A).', { modal: false });
}

function activate(context) {
  try {
    output = vscode.window.createOutputChannel('Dev Healer');
    // Create status bar item for quick "is it doing anything?" visibility.
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusItem.command = 'devHealer.showFixOutput';
    setStatus('Dev Healer: idle', 'Dev Healer is running.');

    output.appendLine(`[dev-healer] activated at ${new Date().toISOString()}`);
    output.appendLine(`[dev-healer] workspaceRoot=${workspaceRoot() || '(none)'}`);
    output.appendLine(`[dev-healer] settings enabled=${cfg().enabled} autoStart=${cfg().autoStart} autoStartBrowser=${cfg().autoStartBrowser}`);
  } catch {
    // ignore
  }

  const start = vscode.commands.registerCommand('devHealer.startWatchedDev', async () => {
    await startWatchedDev();
  });

  const stop = vscode.commands.registerCommand('devHealer.stopWatchedDev', async () => {
    stopWatchedDev();
  });

  const startBrowser = vscode.commands.registerCommand('devHealer.startWatchedBrowser', async () => {
    await startWatchedBrowser();
  });

  const stopBrowser = vscode.commands.registerCommand('devHealer.stopWatchedBrowser', async () => {
    stopWatchedBrowser();
  });

  const reloadBrowser = vscode.commands.registerCommand('devHealer.reloadWatchedBrowser', async () => {
    await reloadWatchedBrowser();
  });

  const openConflictsCmd = vscode.commands.registerCommand('devHealer.openWorkspaceApplyConflicts', async () => {
    await openWorkspaceApplyConflicts();
  });

  const stageResolvedConflictsCmd = vscode.commands.registerCommand('devHealer.stageResolvedWorkspaceConflicts', async () => {
    await stageResolvedWorkspaceConflicts();
  });

  const selfTest = vscode.commands.registerCommand('devHealer.selfTest', async () => {
    // Pure UI test: confirms command wiring + prompt UI + auth banner.
    const sig = 'Internal server error: Failed to resolve import \"__dev_healer_self_test__\"';
    await showAuthHintOnce();
    const choice = await vscode.window.showErrorMessage(
      'Dev Healer Self Test: simulated Vite runtime error.',
      { modal: false, detail: sig },
      'Test Cursor Auth',
      'Fix',
      'Ignore'
    );
    if (choice === 'Test Cursor Auth') {
      try {
        const probePrompt = [
          'You are testing authentication only.',
          'Output ONLY a unified diff patch (git-style, starting with "diff --git").',
          'The patch should add a new file named ".dev-healer/auth-probe.txt" with the single line "ok".',
          'Do not modify any existing files.',
          '',
        ].join('\n');

        await generatePatchOnly(probePrompt);
        vscode.window.showInformationMessage('Self Test: Cursor Agent auth OK (patch generated successfully). No changes were applied.');
      } catch (e) {
        vscode.window.showErrorMessage(`Self Test: Cursor Agent auth FAILED: ${e?.message || e}`);
      }
    } else if (choice === 'Fix') {
      vscode.window.showInformationMessage('Self Test: Fix clicked. In real errors, Dev Healer would generate/apply a patch now.');
    }
  });

  const showFixOutputCmd = vscode.commands.registerCommand('devHealer.showFixOutput', async () => {
    try {
      getFixOutput().show(true);
    } catch {
      // ignore
    }
  });

  const openLastFixLogCmd = vscode.commands.registerCommand('devHealer.openLastFixLog', async () => {
    if (!lastFixLogPath) {
      vscode.window.showInformationMessage('Dev Healer: No fix log has been created yet.');
      return;
    }
    await openFileInEditor(lastFixLogPath);
  });

  const rerunLastFixCmd = vscode.commands.registerCommand('devHealer.rerunLastFix', async () => {
    await rerunLastFixFromSavedPrompt();
  });

  context.subscriptions.push(
    start,
    stop,
    startBrowser,
    stopBrowser,
    reloadBrowser,
    openConflictsCmd,
    stageResolvedConflictsCmd,
    selfTest,
    showFixOutputCmd,
    openLastFixLogCmd,
    rerunLastFixCmd,
    statusItem
  );

  // Auto-start per workspace setting.
  const { enabled, autoStart, autoStartBrowser } = cfg();
  if (enabled && (autoStart || autoStartBrowser)) {
    // Defer to avoid stealing focus during startup.
    setTimeout(() => {
      if (autoStart) {
      startWatchedDev().catch(() => {
        // ignore
      });
      }
      if (autoStartBrowser) {
        // Stagger slightly so dev server has a moment to come up.
        setTimeout(() => {
          startWatchedBrowser().catch(() => {
            // ignore
          });
        }, 800);
      }
    }, 1500);
  }
}

function deactivate() {
  stopWatchedDev();
  stopWatchedBrowser();
}

module.exports = { activate, deactivate };


