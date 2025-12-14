# Cursor Dev Healer

Dev Healer is a **Cursor/VS Code extension** that turns runtime failures into a tight **Fix / Ignore** loop:
- **Watched Dev Server**: parses Vite console output (e.g. `Internal server error`, `Failed to resolve import`, `Pre-transform error`)
- **Watched Browser (Playwright)**: captures real UI errors while you click (console errors, page errors, request failures)

When you click **Fix**, Dev Healer runs your repo’s patcher (default: `node tools/cursor-agent-patch.mjs`) which uses **Cursor Agent** to propose changes, then Dev Healer applies them locally and runs post-fix checks.

## Why it exists
- **Fast**: “error → fix attempt” without leaving the editor
- **Reliable**: worktree isolation + deterministic patch application pipeline
- **Safe-by-default**: command allowlists, workspace apply-back strategies, and conflict guidance

## Features
- **Fix / Ignore prompts** for Vite runtime errors
- **Watched Browser** (Playwright) that captures screenshot/trace artifacts for debugging
- **Manual UI reports** (gesture-driven) to “report what you see” + include expectation/notes
- **Worktree-based fixes** so you can keep working while Dev Healer runs
- **Best-effort apply-back to your main workspace** (stash → cherry-pick → pop by default)
- **Conflict helper toasts + commands** if stash-pop introduces conflicts
- **Rerun last fix** from saved prompt

## Installation (VSIX)
This repo is set up for local packaging.

1. Package:
   - `cd dev-healer-vscode`
   - `npx vsce package` (or `npx --no-install vsce package` if already installed)
2. Install into Cursor:
   - Command Palette → **Extensions: Install from VSIX...**
   - or terminal:
     - `cursor --install-extension /absolute/path/to/cursor-dev-healer-<version>.vsix`

After installation, run:
- **Dev Healer: Start Watched Dev Server**
- (optional) **Dev Healer: Start Watched Browser (Playwright)**

This extension shows a **Fix / Ignore** prompt when Vite prints runtime errors like:
- `Internal server error`
- `Failed to resolve import`
- `Pre-transform error`

Fix uses the repo’s patcher command (`node tools/cursor-agent-patch.mjs`) to generate a **unified diff** and applies it via `git apply` (without stopping Vite).

## Prereqs

- Cursor Agent authenticated:
  - `cursor agent login` OR set `CURSOR_API_KEY`
- Optional model:
  - `CURSOR_AGENT_MODEL=gpt-5.2`

## Run as a normal installed extension (VSIX)

1. Install packaging tool (one-time):
   - `npm i -g @vscode/vsce`
2. Package:
   - `cd dev-healer-vscode`
   - `vsce package`
3. Install into Cursor:
   - Command Palette → **Extensions: Install from VSIX...**
   - or terminal: `cursor --install-extension /absolute/path/to/cursor-dev-healer-0.1.0.vsix`

## Use

Run command:
- **Dev Healer: Start Watched Dev Server**
- **Dev Healer: Start Watched Browser (Playwright)** (optional, for “human clicking” with captured errors)

Stop:
- **Dev Healer: Stop Watched Dev Server**
- **Dev Healer: Stop Watched Browser (Playwright)**

## Notes (Cursor Agent Browser + localhost)

On some macOS setups, Vite may bind only to IPv6 loopback (`[::1]`). In that case:
- `http://localhost:3000` may work (resolves to `::1`)
- `http://127.0.0.1:3000` will fail with `ERR_CONNECTION_REFUSED`

Dev Healer forces the dev command to include `--host` (and sets `VITE_BIND_ALL=1`) so IPv4 loopback works reliably.
If you start Vite outside Dev Healer and hit this, run `npm run dev -- --host` (or `vite --host`).

## Watched Browser (self-healing while you click)

If you want Dev Healer to react to **real UI errors produced by your own “human” navigation**, start the watched browser:
- It launches a **headed Playwright Chromium window** you can interact with normally.
- When the page throws a `pageerror` / `console.error` / request failure, it:
  - logs a `DEV_HEALER_BROWSER_EVENT ...` line
  - writes a screenshot + trace under `.dev-healer/`
  - triggers the same **Fix / Ignore** flow (Fix runs the Cursor Agent patcher)

Manual “Report for Repair”:
- Use **Alt+Shift+Right-click** in the watched Playwright Chromium window.
- Dev Healer will capture a screenshot (and a tight clip), and Cursor will prompt you for the expected behavior when you click **Fix**.

What to put in “Add notes (optional)”:
- Repro steps (what you clicked / typed / navigated)
- What you saw vs expected (UI state, error message text)
- Constraints (e.g. “don’t change API shape”, “keep keyboard focus”, “must work on mobile breakpoint”)
- Anything the screenshot can’t capture (timing, animation, intermittent behavior)

Issue tracking log:
- Dev Healer appends a JSONL audit trail to `.dev-healer/issues.jsonl` (issue id, event metadata, screenshots, and fix outcomes).
- If a fix fails, details are also written to `.dev-healer/errors/<issueId>.txt`.

Ignore rules:
- If you click **Ignore always** on a prompt, Dev Healer will persist an ignore rule to `.dev-healer/ignore.json`.
- Rules are simple substring matches (signature/message/location URL) so you can edit the file manually if needed.

Settings:
- `devHealer.browserCommand` (default: `node tools/dev-healer-browser.mjs`)
- `devHealer.browserUrl` (default: `http://127.0.0.1:3000/`)
- `devHealer.browserCaptureMode` (default: `both`)
- `devHealer.browserGroupWindowMs` (default: `1500`)
- `devHealer.fixMaxRetries` (default: `2`)
  - `manual`: only capture screenshot/trace when you use the report gesture
  - `auto`: capture on `pageerror` / `console.error` (rate-limited)
  - `both`: do both

Auto-start:
- `devHealer.autoStart`: start watched dev server on workspace open
- `devHealer.autoStartBrowser`: start watched Playwright browser on workspace open (opt-in)

## Workspace apply-back + conflicts
When Dev Healer runs in a worktree, it can apply the successful fix commit back to your current branch.

- **Default**: `devHealer.fixCherryPickStrategy = "stashAndPop"`
  - stashes your dirty workspace (`git stash -u`)
  - cherry-picks the fix commit
  - pops your stash

If `git stash pop` produces conflicts, Dev Healer will:
- show a **toast** with buttons to open conflicted files, stage resolved changes, copy commands, or open the fix log
- expose helper commands:
  - **Dev Healer: Open Workspace Apply Conflicts**
  - **Dev Healer: Stage Resolved Workspace Conflicts**

## Security / privacy notes (high-level)
- Dev Healer writes local debug artifacts under `.dev-healer/` (prompts, logs, screenshots, traces) for reproducibility.
- Post-fix commands can be restricted via `devHealer.fixPostFixCommandsAllowlist`.
- Treat anything sent to an LLM as sensitive; redact secrets and avoid including credentials in prompts/logs.

## Contributing
See `CONTRIBUTING.md`.

## License
See `LICENSE`.

