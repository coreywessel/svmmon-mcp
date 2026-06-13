#!/usr/bin/env bash
# pre-commit-secrets.sh — blocks commits that contain real-looking API keys.
# Mirrors the sm-automation workspace scanner + adds the Svmmon svm_ key shape
# (the crown-jewel credential for this public MCP repo).
# Install: ln -sf ../../scripts/pre-commit-secrets.sh .git/hooks/pre-commit
# Bypass:  git commit --no-verify   (BANNED per ~/.claude/CLAUDE.md without explicit Corey approval)

set -u

# Only scan the staged diff (added/modified lines), not the full repo.
STAGED=$(git diff --cached --no-color -U0)

if [ -z "$STAGED" ]; then
  exit 0
fi

# Patterns: real-key shapes only. Placeholders pass (xxx, YOUR_, <...>, svm_…, ${VAR}, process.env.X).
PATTERNS=(
  # Svmmon API key — the credential this MCP holds. Real keys are svm_ + a long token.
  'svm_[A-Za-z0-9]{20,}'
  # Anthropic
  'sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{80,}'
  # Stripe live
  'sk_live_[A-Za-z0-9]{20,}'
  'rk_live_[A-Za-z0-9]{20,}'
  # OpenAI
  'sk-proj-[A-Za-z0-9_-]{40,}'
  # AWS access key
  'AKIA[0-9A-Z]{16}'
  # GitHub PATs
  'ghp_[A-Za-z0-9]{36}'
  'gho_[A-Za-z0-9]{36}'
  'ghs_[A-Za-z0-9]{36}'
  'github_pat_[A-Za-z0-9_]{80,}'
  # Slack
  'xox[abprs]-[0-9]+-[0-9]+-[A-Za-z0-9]+'
  # Google API
  'AIza[0-9A-Za-z_-]{35}'
)

HITS=0
for pat in "${PATTERNS[@]}"; do
  matches=$(printf '%s\n' "$STAGED" | grep -nE '^[+]' | grep -v '^[+][+][+]' | grep -EI "$pat" || true)
  matches=$(printf '%s\n' "$matches" | grep -vE '(xxx|x{10,}|YOUR_|<.*>|fakekey|placeholder|example\.|process\.env|\$\{|…)' || true)
  if [ -n "$matches" ]; then
    echo "BLOCKED: suspected secret matching pattern: $pat" >&2
    echo "$matches" >&2
    HITS=$((HITS + 1))
  fi
done

if [ "$HITS" -gt 0 ]; then
  echo "" >&2
  echo "Pre-commit secret scan blocked $HITS suspicious pattern(s)." >&2
  echo "If this is a false positive, rewrite the value to a placeholder (svm_… / YOUR_KEY)." >&2
  echo "To bypass (REQUIRES Corey approval): git commit --no-verify" >&2
  exit 1
fi

exit 0
