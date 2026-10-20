#!/bin/sh
# Opt in per clone: bash scripts/install-hooks.sh
set -eu
cd "$(git rev-parse --show-toplevel)"
existing=$(git config --get core.hooksPath || true)
if [ -n "$existing" ] && [ "$existing" != scripts/hooks ]; then
  printf 'Existing hooksPath is %s; add python3 scripts/check-file-size.py --staged to its pre-commit hook.\n' "$existing" >&2
  exit 1
fi
local_hooks=$(git rev-parse --git-path hooks)
active_hooks=''
if [ -d "$local_hooks" ]; then
  active_hooks=$(find -L "$local_hooks" -type f ! -name '*.sample' -exec sh -c '
    for hook do
      if [ -x "$hook" ]; then printf "%s\n" "$hook"; fi
    done
  ' sh {} +)
fi
if [ -n "$active_hooks" ]; then
  printf 'Refusing to disable existing executable hooks:\n%s\nAdd the file-size check to the existing hooks instead.\n' "$active_hooks" >&2
  exit 1
fi
git config core.hooksPath scripts/hooks
printf 'Enabled staged file-size checks for this clone.\n'
