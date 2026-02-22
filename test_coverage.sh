#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

TMP_OUTPUT="$(mktemp /tmp/hal-minting-contracts-coverage.XXXXXX)"
REPORT_FILE="$ROOT_DIR/test_coverage.report"
trap 'rm -f "$TMP_OUTPUT"' EXIT

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

STATUS="pass"
LANGUAGE_STATUS="pass"
if awk -v line="$line_pct" -v branch="$branch_pct" 'BEGIN { exit !((line + 0) < 90 || (branch + 0) < 90) }'; then
  STATUS="fail"
  LANGUAGE_STATUS="fail"
fi

{
  echo "FORMAT_VERSION=1"
  echo "REPO=hal-minting-contracts"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "THRESHOLD_LINES=90"
  echo "THRESHOLD_BRANCHES=90"
  echo "TOTAL_LINES_PCT=$line_pct"
  echo "TOTAL_BRANCHES_PCT=$branch_pct"
  echo "STATUS=$STATUS"
  echo "SOURCE_PATHS=src/index.ts,src/contracts/**,src/helpers/**"
  echo "EXCLUDED_PATHS=NONE"
  echo "LANGUAGE_SUMMARY=nodejs:lines=$line_pct,branches=$branch_pct,tool=vitest-v8,status=$LANGUAGE_STATUS"
  echo ""
  echo "=== RAW_OUTPUT_VITEST ==="
  cat "$TMP_OUTPUT"
  echo ""
  echo "=== RAW_OUTPUT_COVERAGE_SUMMARY_JSON ==="
  cat coverage/coverage-summary.json
} > "$REPORT_FILE"

if [[ "$STATUS" != "pass" ]]; then
  echo "Coverage threshold failed: lines=$line_pct, branches=$branch_pct" >&2
  exit 1
fi

echo "Coverage threshold met: lines=$line_pct, branches=$branch_pct"
