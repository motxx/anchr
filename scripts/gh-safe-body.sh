#!/usr/bin/env bash
# gh-safe-body — scan a PR/issue body for local path leaks before posting.
#
# Why: PR #51's body leaked a `~/.gstack/projects/...` path because the
# body was passed inline to `gh pr create --body`. This wrapper forces the
# text through `scripts/check-no-local-paths.ts` first.
#
# Usage (create PR):
#   scripts/gh-safe-body.sh create --title "..." <<'EOF'
#   ## Summary
#   ...
#   EOF
#
# Usage (edit PR):
#   scripts/gh-safe-body.sh edit 51 <<'EOF'
#   ...
#   EOF
#
# Usage (issue):
#   scripts/gh-safe-body.sh issue-create --title "..." <<'EOF'
#   ...
#   EOF
#
# The body is read from stdin. A temp file is used so `gh` gets `--body-file`,
# which preserves exact formatting.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 {create|edit|issue-create|issue-edit} [args...]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

mode="$1"; shift

# Read stdin to temp file.
tmp="$(mktemp -t gh-safe-body.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"

# Leak-scan.
if ! deno run --allow-read "$SCRIPT_DIR/check-no-local-paths.ts" "$tmp" >&2; then
  echo "" >&2
  echo "✗ refusing to post body — local paths detected. Fix above." >&2
  exit 1
fi

case "$mode" in
  create)       exec gh pr create --body-file "$tmp" "$@" ;;
  edit)         exec gh pr edit "$1" --body-file "$tmp" "${@:2}" ;;
  issue-create) exec gh issue create --body-file "$tmp" "$@" ;;
  issue-edit)   exec gh issue edit "$1" --body-file "$tmp" "${@:2}" ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac
