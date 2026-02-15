# AGENTS.md

This file defines the expectations for any human or AI agent working in this
repository. The goal is enterprise-grade, production-ready software with
creative and inventive UI/UX that stays minimal and purposeful.

## Non-negotiables

- Production-only output. No theater, no stubs, no TODO-driven placeholders.
- If an exception is unavoidable, disclose it explicitly and list concrete
  remediation steps (what, who, and when).
- Single Responsibility Principle (SRP) for modules, components, and services.
- No duplication of existing logic. Prefer reuse or refactor before adding
  parallel implementations.
- Tight, high-performing code with minimal surface area.
- Documentation must be concise and functional (no fluff).
- UI should use as few "lights" (visual noise, gratuitous effects) as possible
  while still achieving the intended experience.

## Truthfulness and execution rules (12)

1. No false claims: Never report results you did not verify.
2. Definition of Done: Do not declare done unless the outcome is delivered.
3. No theater code: No faux UX, placeholder toggles, or simulated AI.
4. Plan breakdown: Keep plans short and confirm completion of each step.
5. Verify each task: Do not proceed when a prior step is broken.
6. No bulk sed: Avoid blind mass edits that risk correctness.
7. Deploy + verify: Security or infra work must be built, deployed, and verified.
8. Honest reporting: Status must match actual systems, not intent.
9. Error handling required: No silent failures or catch-all without action.
10. Frontend-backend contract: UI must reflect live API data, not hardcoded mocks.
11. Commit honesty: Commit messages must match actual changes.
12. Research = execution: Cited patterns must be implemented, not aspirational.

## Git workflow (required)

- Always work on a new branch (never commit directly to `main`).
- Push branch → open PR → merge to `main`.
- After merge: delete the remote branch and delete the local branch.
- Exceptions require explicit user instruction (e.g., emergency hotfix straight to `main`).

## Deployment in this repo (staging-driven)

This repo uses **GitHub Actions** and protected environments. In practice,
**deploying to staging happens by pushing to the `staging` branch**.

### What triggers a staging deploy

- **Services → Cloud Run**: push to `staging` with changes under `services/**`
  triggers the **Deploy Services** workflow.
- **Infra / workflows (Terraform / Cloud Workflows)**: push to `staging` with
  changes under `terraform/**` or `workflows/**` triggers the
  **Deploy Infrastructure** workflow.

### How to fetch deploy evidence (required for “deployed + verified” claims)

- List runs:
  - `gh run list --branch staging --workflow "Deploy Services" --limit 5`
  - `gh run list --branch staging --workflow "Deploy Infrastructure" --limit 5`
- View a run summary:
  - `gh run view <run_id>`
- Get step-by-step logs (useful for smoke test output):
  - `gh api /repos/<org>/<repo>/actions/runs/<run_id>/logs` (zip)

Tip: this environment may inject an invalid `GITHUB_TOKEN` env var that breaks
`gh`. Prefer:

- `env -u GITHUB_TOKEN gh ...`

### Common failure modes (staging)

- **“Missing Cloud Run service: …”** during api-backend deploy:
  - A required dependent service was not created/deployed yet.
  - Fix by deploying the missing service first, or making the dependency
    optional if appropriate for staging rollout.
- **Private service smoke tests**:
  - Unauthenticated `/health` should return **401/403** for private services.
- **GitHub CLI permissions**:
  - `git push` can work (contents write) while `gh pr create` / workflow
    dispatch fails (missing PR/actions permissions). If `gh` returns
    “Resource not accessible by integration”, use the GitHub UI or update the
    token permissions.

## Product and UX standards

- User-centered flows, clear information architecture, and consistent patterns.
- Inventive visuals are welcome, but must remain purposeful and accessible.
- Accessibility is mandatory: keyboard, screen readers, contrast, and focus
  states (aim for WCAG AA or better).
- Use a design system: tokens for color, spacing, typography, motion, and
  elevation. Keep visual noise low.
- Motion should reinforce intent, not distract. Prefer subtle, fast animations.

## Frontend: React (web)

- Prefer TypeScript when available; keep props and state typed.
- Use functional components and hooks with small, focused responsibilities.
- Avoid excessive global state; local state first, then context, then a store.
- Protect performance: memoize expensive work, virtualize large lists, and
  avoid re-renders from unstable props.
- Handle loading, empty, and error states with real UX, not placeholders.
- Use error boundaries and request cancellation for unmounted components.

## Frontend: React Native

- Match native platform conventions and respect platform differences.
- Use FlatList/SectionList for large data sets; avoid heavy custom layouts.
- Prefer native modules only when necessary; keep JS bridge traffic low.
- Ensure accessibility for mobile: focus, hints, and dynamic text sizes.
- Plan for offline/poor connectivity with caching and resilient UX.

## Backend: Rust

- Favor safe Rust; use `unsafe` only with a documented safety rationale.
- Prefer async I/O for network-bound operations; avoid blocking in async tasks.
- Structured errors and logs (traceable, actionable, no sensitive data).
- Keep modules small and composable; validate inputs at boundaries.

## Backend: Python (services for React/React Native)

- Favor typed code (type hints) and clear module boundaries.
- Validate inputs at the edge (e.g., request models and schema validation).
- Use structured logging; avoid secrets or PII in logs.
- Prefer async where it meaningfully improves throughput.

## Architecture and APIs

- Clear boundaries: UI, domain, data access, integrations.
- Contract-first APIs with versioning, consistent error shapes, and pagination.
- Idempotent write operations where feasible.
- Avoid breaking changes without migration paths.

## Repository structure

- Use consistent top-level domains: `/apps`, `/packages`, `/services`, `/libs`,
  `/docs`, `/infra` (only when needed).
- Each app/service must have `src/`, `tests/`, and a minimal entrypoint.
- Keep directory depth shallow; refactor when nesting exceeds clarity.
- Shared code lives in `/libs` or `/packages`; do not duplicate.

## File naming conventions

- React components: `PascalCase.tsx` matching exported component name.
- Hooks: `useThing.ts` (camelCase, `use` prefix).
- Non-component JS/TS modules: `kebab-case.ts` unless a framework requires
  otherwise.
- Tests: `*.test.*` / `*.spec.*`; React Native tests may use `*.native.*`;
  E2E tests use `*.e2e.*` or `/e2e/`.
- Python: `snake_case.py` modules, `test_*.py` tests, packages with `__init__.py`.
- Rust: `snake_case.rs` modules; prefer `module.rs` over `mod.rs` except for crate
  roots.
- Documentation: `kebab-case.md`; ADRs as `/docs/adr/NNNN-title.md`.

## Documentation standards

- Root `README.md` must cover purpose, setup, env, and core workflows.
- Each app/service needs a focused `README.md` with run/build/test steps.
- `/docs` hosts architecture, data flow, and ADRs; keep current with changes.
- Public APIs require OpenAPI or equivalent contract docs.
- Docstrings only for public APIs or complex logic; no redundant comments.

## Security and secrets

- All long-term secrets must use the project's secret storage.
- Local `.env` is only for dev/test and must not contain production secrets.
- No secrets or credentials in source, logs, or tests.
- Threat model user inputs: validate, sanitize, and encode outputs.
- Use least privilege for service accounts and tokens.

## Observability and reliability

- Emit structured logs, metrics, and traces for all services.
- Propagate correlation IDs end-to-end; never log PII.
- Define SLIs/SLOs and alert on error-budget burn.
- Health checks, graceful shutdowns, and safe retries are required.

## Dependency and supply-chain policy

- Lockfiles are required; no unpinned dependencies.
- Use official registries only; forbid unknown sources.
- Run vulnerability scanning and dependency review on PRs.
- Enforce a license allow/deny list.

## Data handling and privacy

- Classify data; minimize collection; enforce retention and deletion.
- Encrypt sensitive data in transit and at rest.
- Require explicit consent and opt-out for analytics/telemetry.

## Performance budgets

- Frontend budgets: LCP/INP/CLS and bundle size limits.
- Backend budgets: p95 latency and throughput targets.
- CI must fail on budget regressions.

## Internationalization and accessibility

- No hard-coded user strings; use i18n keys and locale formatting.
- Support RTL where applicable.
- Automated a11y checks plus manual checks on critical flows.

## Release and rollback

- SemVer and changelog updates are required for releases.
- Provide rollback paths for every deployment.
- Migrations must be reversible or have explicit cutovers.

## Feature flags and experiments

- Flags require an owner, expiry date, and cleanup plan.
- Experiments require tracking, analysis, and removal.

## API compatibility

- Preserve backward compatibility or version endpoints.
- Deprecate with timelines and migration guides.
- Use contract tests for critical integrations.

## Code ownership and review

- CODEOWNERS required for critical paths.
- High-risk changes require two reviewers.
- New behavior requires tests; no untested logic.

## Testing and quality gates

- Add unit, integration, and end-to-end tests as appropriate.
- Run linting, formatting, and type checks for each stack involved.
- Fix all lint and test findings before merge.
- Performance budgets: measure and avoid regressions.
- Visual E2E is enforced in CI when UI/visual changes are detected. Tag
  screenshot tests with `@visual` and set `PW_BASE_URL` in secrets.

## Tooling guardrails (Feb 2026 baseline)

- JS/TS (React/React Native): ESLint (flat config) + Prettier, `tsc` type checks,
  Vitest + Testing Library (web), Jest + RN Testing Library (native), Playwright
  for E2E with `@visual`-tagged screenshot tests.
- Python: Ruff (lint+format), Mypy (types), Pytest (+ asyncio/cov).
- Rust: rustfmt, clippy, cargo test.
- Pre-commit enforces lint/format/typecheck/tests per language.
- Local visual E2E pre-commit runs only when `PW_BASE_URL` is set and `@visual`
  tests are touched.

## Decision rationale and expectations

- Non-negotiables: Why: prevent waste and fragile code. Expect: production-grade,
  minimal, SRP-first changes only.
- Product and UX: Why: usability drives adoption. Expect: accessible, purposeful
  UI with minimal visual noise.
- React (web): Why: performance and maintainability. Expect: typed, small
  components, stable state, resilient loading/error UX.
- React Native: Why: native feel and device constraints. Expect: platform
  conventions, list virtualization, offline tolerance.
- Rust: Why: safety and speed at scale. Expect: safe-by-default, async I/O,
  clear errors and boundaries.
- Python: Why: service clarity and correctness. Expect: typed edges, schema
  validation, structured logs.
- Architecture and APIs: Why: long-term evolution without breakage. Expect:
  explicit contracts, versioning, idempotency.
- Repository structure: Why: predictable navigation. Expect: consistent top-level
  domains and shallow directory depth.
- File naming: Why: fast discovery. Expect: naming matches role and framework
  conventions.
- Documentation: Why: operational clarity. Expect: concise, task-focused docs
  that are kept current.
- Security and secrets: Why: reduce breach risk. Expect: secret storage, least
  privilege, no credentials in code/logs.
- Observability and reliability: Why: detect issues early. Expect: logs/metrics/
  traces with SLIs/SLOs and safe retries.
- Dependency and supply-chain: Why: prevent compromise. Expect: locked deps,
  vetted sources, license control.
- Data handling and privacy: Why: user trust and compliance. Expect: minimization,
  retention rules, encryption.
- Performance budgets: Why: avoid regressions. Expect: measurable budgets and CI
  enforcement.
- Internationalization and accessibility: Why: inclusive product. Expect: i18n
  keys, RTL support, a11y checks.
- Release and rollback: Why: safe delivery. Expect: SemVer, changelog, rollback
  plans, reversible migrations.
- Feature flags and experiments: Why: controlled rollout. Expect: ownership,
  expiry, cleanup.
- API compatibility: Why: client stability. Expect: backward compatibility or
  versioned endpoints with migration paths.
- Code ownership and review: Why: accountability. Expect: required reviewers and
  tests for new behavior.
- Testing and quality gates: Why: prevent defects. Expect: all checks pass before
  merge; visual E2E enforced on UI changes.
- Tooling guardrails: Why: consistent automation. Expect: standardized linters,
  formatters, and test runners.
- Mock data policy: Why: avoid false confidence. Expect: dynamic mocks only, with
  explicit remediation plans.
- Definition of Done: Why: shared bar for completion. Expect: production-ready,
  secure, and fully tested changes.

## Mock data policy

- Mock data is allowed only if dynamic (generated at runtime) and clearly
  isolated from production paths.
- Any mock-only behavior must be disclosed with a remediation plan.

## Definition of Done

- All code is production-ready and SRP-compliant.
- No placeholders, stubs, or hidden TODOs.
- Linting, formatting, type checks, and tests pass.
- Security requirements met; secrets handled correctly.
- Documentation updated where behavior or usage changed.
