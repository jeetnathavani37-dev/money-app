#!/bin/bash
set -euo pipefail

# Only relevant for Claude Code on the web: ~/.claude is a fresh, ephemeral
# per-session directory there, so the ui-ux-pro-max plugin needs reinstalling
# on every new container. On a persistent local machine it only needs to be
# installed once, so skip this hook there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

MARKETPLACE="ui-ux-pro-max-skill"
PLUGIN="ui-ux-pro-max@${MARKETPLACE}"

if claude plugin list 2>/dev/null | grep -qF "$PLUGIN"; then
  exit 0
fi

claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
claude plugin install "$PLUGIN"
