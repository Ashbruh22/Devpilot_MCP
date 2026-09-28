#!/usr/bin/env bash
# Publish the demo repo to GitHub and file its issues.
# Requires: gh (authenticated), git. Usage: demo/publish.sh [owner] [repo]
set -euo pipefail
OWNER="${1:-Ashbruh22}"
REPO="${2:-devpilot-demo}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp -R "$HERE/devpilot-demo/." "$TMP/"
rm -rf "$TMP/node_modules"
cd "$TMP"
git init -q -b main
git add -A
git commit -qm "Initial commit: pricing and date helpers (with known bugs)"
gh repo create "$OWNER/$REPO" --public --source=. --push \
  --description "Tiny shop library with real bugs, used to demo and benchmark DevPilot MCP"

for f in "$HERE"/issues/*.md; do
  title="$(sed -n 's/^title: //p' "$f" | head -1)"
  labels="$(sed -n 's/^labels: *//p' "$f" | head -1)"
  body="$(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2' "$f")"
  args=(--repo "$OWNER/$REPO" --title "$title" --body "$body")
  if [ -n "$labels" ]; then
    gh label create "$labels" --repo "$OWNER/$REPO" --force >/dev/null 2>&1 || true
    args+=(--label "$labels")
  fi
  gh issue create "${args[@]}"
done
echo "Done: https://github.com/$OWNER/$REPO"
