#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

TMP_OUTPUT="$(mktemp /tmp/hal-minting-contracts-coverage.XXXXXX)"

INCLUDE_ARGS=(
  --coverage.include=src/index.ts
  --coverage.include=src/contracts/config.ts
  --coverage.include=src/contracts/index.ts
  --coverage.include=src/contracts/optimized-blueprint.ts
  --coverage.include=src/contracts/unoptimized-blueprint.ts
  --coverage.include=src/contracts/validators.ts
  --coverage.include=src/contracts/data/index.ts
  --coverage.include=src/contracts/data/settings.ts
  --coverage.include=src/contracts/data/settings_v1.ts
  --coverage.include=src/helpers/index.ts
  --coverage.include=src/helpers/blockfrost/index.ts
  --coverage.include=src/helpers/common/index.ts
)

npx vitest run tests/mint.test.ts \
  --coverage \
  --coverage.provider=v8 \
  "${INCLUDE_ARGS[@]}" \
  --coverage.reporter=text-summary \
  --coverage.reporter=json-summary \
  --coverage.reporter=lcov | tee "$TMP_OUTPUT"

if [ ! -f coverage/coverage-summary.json ]; then
  echo "Missing coverage/coverage-summary.json after test run" >&2
  exit 1
fi

line_pct="$(node -e "const s=require('./coverage/coverage-summary.json'); process.stdout.write(String(s.total.lines.pct));")"
branch_pct="$(node -e "const s=require('./coverage/coverage-summary.json'); process.stdout.write(String(s.total.branches.pct));")"

awk -v line="$line_pct" -v branch="$branch_pct" 'BEGIN { if ((line + 0) < 90 || (branch + 0) < 90) exit 1 }'

{
  echo "line_pct=$line_pct"
  echo "branch_pct=$branch_pct"
  echo ""
  node -e "const s=require('./coverage/coverage-summary.json'); console.log(JSON.stringify({ total: s.total }, null, 2));"
} > test_coverage.report

echo "Coverage threshold met: lines=$line_pct, branches=$branch_pct"
