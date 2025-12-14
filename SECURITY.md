# Security Policy

## Reporting a vulnerability
If you believe you’ve found a security issue, please **do not** open a public issue.

Instead, report it privately to the maintainers with:
- A clear description of the issue
- Steps to reproduce
- Potential impact
- Any suggested mitigations

## Scope notes
Dev Healer can execute repo-defined post-fix commands and can capture logs/screenshots/traces under `.dev-healer/`.

If you’re using Dev Healer in a sensitive environment:
- Use `devHealer.fixPostFixCommandsAllowlist`
- Be careful about what gets included in prompts/logs
- Treat `.dev-healer/` as sensitive local artifact storage


