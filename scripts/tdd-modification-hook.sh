#!/usr/bin/env bash
set -euo pipefail

# TDD modification guard:
# - exits 2 when changes touch test files/paths
# - used for pre-tool checks and git-diff checks in pre-commit/CI

ALLOW_OVERRIDE="${ALLOW_TDD_TEST_MODIFICATIONS:-0}"

if [[ "${ALLOW_OVERRIDE}" == "1" ]]; then
  exit 0
fi

is_protected_test_path() {
  local candidate="$1"
  local lowered
  lowered="$(printf '%s' "${candidate}" | tr '[:upper:]' '[:lower:]')"

  if [[ "${lowered}" == tests/* ]]; then
    return 0
  fi
  if [[ "${lowered}" == *"/tests/"* ]]; then
    return 0
  fi
  if [[ "${lowered}" == *"/test/"* ]]; then
    return 0
  fi
  if [[ "${lowered}" == test_* ]]; then
    return 0
  fi
  if [[ "${lowered}" == *_test.py ]]; then
    return 0
  fi
  if [[ "${lowered}" == *.test.* ]]; then
    return 0
  fi
  if [[ "${lowered}" == *.spec.* ]]; then
    return 0
  fi
  if [[ "${lowered}" == *test* ]]; then
    return 0
  fi
  return 1
}

deny_path() {
  local bad_path="$1"
  echo "TDD Modification Hook: modifications to test folders are not allowed." >&2
  echo "Blocked path: ${bad_path}" >&2
  echo "To intentionally bypass, set ALLOW_TDD_TEST_MODIFICATIONS=1 for this command." >&2
  exit 2
}

check_paths() {
  local paths=("$@")
  local p
  for p in "${paths[@]}"; do
    [[ -z "${p}" ]] && continue
    if is_protected_test_path "${p}"; then
      deny_path "${p}"
    fi
  done
}

mode="${1:-}"

case "${mode}" in
  --path)
    if [[ $# -lt 2 ]]; then
      echo "Usage: $0 --path <file-path>" >&2
      exit 1
    fi
    check_paths "$2"
    ;;
  --staged)
    mapfile -t changed_files < <(git diff --cached --name-only --diff-filter=ACMR)
    check_paths "${changed_files[@]}"
    ;;
  --range)
    if [[ $# -lt 2 ]]; then
      echo "Usage: $0 --range <git-range>" >&2
      exit 1
    fi
    mapfile -t changed_files < <(git diff --name-only --diff-filter=ACMR "$2")
    check_paths "${changed_files[@]}"
    ;;
  *)
    echo "Usage: $0 --path <file-path> | --staged | --range <git-range>" >&2
    exit 1
    ;;
esac
