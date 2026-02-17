#!/usr/bin/env bash
set -euo pipefail

# Configure repo-managed git hooks.
# This sets: core.hooksPath=.githooks (local repo config).
#
# Safe to re-run; idempotent.

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

if [[ ! -d ".githooks" ]]; then
  echo "❌ Missing .githooks/ directory. Run from repo root." >&2
  exit 1
fi

chmod +x .githooks/pre-commit .githooks/pre-push

git config core.hooksPath .githooks

echo "✅ Configured repo-managed hooks:"
echo "   core.hooksPath=$(git config --get core.hooksPath)"
echo ""
echo "Next steps:"
echo " - Ensure pre-commit is installed: pipx install pre-commit (or your preferred method)"
echo " - Run: pre-commit install --hook-type pre-commit --hook-type pre-push"
echo "   (Optional: pre-commit autoupdate)"
