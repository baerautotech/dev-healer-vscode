# Dependencies and tooling baseline (Feb 2026)

This document defines the standard linting/testing toolchain for the
organization. It is referenced by AGENTS.md and enforced by policy sync.

## JavaScript / TypeScript (React, React Native)

Linting and formatting:

- ESLint (flat config)
- Prettier

Type checks:

- TypeScript (`tsc`)

Testing:

- Vitest + Testing Library (web)
- Jest + React Native Testing Library (native)
- Playwright for E2E and visual tests (`@visual` tags)

## Python

Linting and formatting:

- Ruff (lint + format)

Type checks:

- Mypy

Testing:

- Pytest (+ pytest-asyncio, pytest-cov)

## Rust

Formatting and linting:

- rustfmt
- clippy

Testing:

- cargo test

## Visual E2E (Playwright)

- Visual tests are tagged with `@visual`.
- CI runs visual E2E on UI/visual-impact changes only.
- `PW_BASE_URL` must be set as a repo secret.
- `PW_BROWSERS=all` enables cross-browser visual runs.
