#!/bin/sh
# Opt in per clone: bash scripts/install-hooks.sh
set -eu
cd "$(git rev-parse --show-toplevel)"
existing=$(git config --get core.hooksPath || true)
if [ -n "$existing" ] && [ "$existing" != scripts/hooks ]; then
  printf 'Existing hooksPath is %s; add python3 scripts/check-file-size.py --staged to its pre-commit hook.\n' "$existing" >&2
  exit 1
fi
local_hook=$(git rev-parse --git-path hooks/pre-commit)
if [ -f "$local_hook" ]; then
  printf 'Existing hook at %s; add python3 scripts/check-file-size.py --staged there before opting in.\n' "$local_hook" >&2
  exit 1
fi
git config core.hooksPath scripts/hooks
printf 'Enabled staged file-size checks for this clone.\n'
