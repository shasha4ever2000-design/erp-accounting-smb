#!/usr/bin/env bash
# Builds the Claude SEO Python runtime (.claude/skills/seo/.venv) if it is missing.
# The venv is git-ignored, so fresh checkouts and cloud sessions need this once.
SEO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/.claude/skills/seo"
[ -x "$SEO/.venv/bin/python" ] && exit 0
"$SEO/scripts/claude-seo" setup >/dev/null 2>&1 || true
exit 0
