# Contributing

Thanks for helping improve **Cursor Dev Healer**.

## Development setup
- Node.js + npm
- Cursor (or VS Code)

From this folder:
- Install deps: `npm install`
- Package VSIX: `npx vsce package`

Install the VSIX into Cursor:
- `cursor --install-extension /absolute/path/to/cursor-dev-healer-<version>.vsix`
- Then run **Developer: Reload Window**

## Local testing workflow
- Use **Dev Healer: Self Test (Fix/Ignore Prompt)** to verify command wiring and auth.
- Use **Dev Healer: Start Watched Dev Server** to validate Vite error prompting.
- Use **Dev Healer: Start Watched Browser (Playwright)** and trigger a manual report gesture to validate capture + prompt flow.

## Pull request checklist
- Keep changes minimal and focused.
- Update `CHANGELOG.md` for user-visible changes.
- If you add settings, update `package.json` contributes.configuration and the README.
- Avoid committing artifacts:
  - `node_modules/`
  - `*.vsix`

## Reporting bugs
Please include:
- Extension version
- Repro steps
- Relevant log excerpts (Dev Healer output channel + fix log if available)


