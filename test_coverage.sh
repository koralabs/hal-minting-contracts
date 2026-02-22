#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

REPORT_FILE="$ROOT_DIR/test_coverage.report"
THRESHOLD_LINES=90
THRESHOLD_BRANCHES=90

TEST_LOG="$(mktemp /tmp/hal-minting-contracts-tests.XXXXXX)"
AIKEN_LOG="$(mktemp /tmp/hal-minting-contracts-aiken.XXXXXX)"
INT_DIR="$(mktemp -d /tmp/hal-minting-contracts-int.XXXXXX)"
UNIT_DIR="$(mktemp -d /tmp/hal-minting-contracts-unit.XXXXXX)"
MERGE_IN="$(mktemp -d /tmp/hal-minting-contracts-merge-input.XXXXXX)"
MERGED_DIR="$(mktemp -d /tmp/hal-minting-contracts-merged.XXXXXX)"

cleanup() {
  rm -f "$TEST_LOG" "$AIKEN_LOG"
  rm -rf "$INT_DIR" "$UNIT_DIR" "$MERGE_IN" "$MERGED_DIR"
}
trap cleanup EXIT

npm test -- \
  --coverage \
  --coverage.provider=v8 \
  --coverage.include=src/**/*.ts \
  --coverage.reporter=json \
  --coverage.reporter=json-summary \
  --coverage.clean=true \
  --coverage.reportsDirectory="$INT_DIR" | tee "$TEST_LOG"

npm run test:unit -- \
  --coverage \
  --coverage.provider=v8 \
  --coverage.include=src/**/*.ts \
  --coverage.reporter=json \
  --coverage.reporter=json-summary \
  --coverage.clean=true \
  --coverage.reportsDirectory="$UNIT_DIR" | tee -a "$TEST_LOG"

AIKEN_TOOL="aiken unavailable"
AIKEN_EXIT="NA"
AIKEN_NOTE="aiken not installed"
if command -v aiken >/dev/null 2>&1; then
  if aiken --help | grep -q "test"; then
    AIKEN_TOOL="aiken test"
    set +e
    (
      cd smart-contract
      aiken test
    ) | tee "$AIKEN_LOG"
    AIKEN_EXIT="$?"
    set -e
  else
    AIKEN_TOOL="aiken check"
    set +e
    (
      cd smart-contract
      aiken check
    ) | tee "$AIKEN_LOG"
    AIKEN_EXIT="$?"
    set -e
  fi
  if [ "$AIKEN_EXIT" = "0" ]; then
    AIKEN_NOTE="$AIKEN_TOOL completed (coverage metrics unavailable)"
  else
    AIKEN_NOTE="$AIKEN_TOOL exited with code $AIKEN_EXIT (see raw output)"
  fi
else
  echo "aiken command not found; skipped aiken test run." | tee "$AIKEN_LOG"
fi

cp "$INT_DIR/coverage-final.json" "$MERGE_IN/integration.json"
cp "$UNIT_DIR/coverage-final.json" "$MERGE_IN/unit.json"

npx nyc merge "$MERGE_IN" "$MERGED_DIR/coverage-final.json" | tee -a "$TEST_LOG"
npx nyc report \
  --temp-dir "$MERGED_DIR" \
  --report-dir "$MERGED_DIR" \
  --reporter=json-summary \
  --reporter=text-summary \
  --reporter=lcov | tee -a "$TEST_LOG"

if [ ! -f "$MERGED_DIR/coverage-summary.json" ]; then
  echo "Missing merged coverage summary." >&2
  exit 1
fi

line_pct="$(node -e "const s=require(process.argv[1]).total; process.stdout.write(String(s.lines.pct));" "$MERGED_DIR/coverage-summary.json")"
branch_pct="$(node -e "const s=require(process.argv[1]).total; process.stdout.write(String(s.branches.pct));" "$MERGED_DIR/coverage-summary.json")"

node_status="pass"
status="pass"
if awk -v line="$line_pct" -v branch="$branch_pct" -v min_line="$THRESHOLD_LINES" -v min_branch="$THRESHOLD_BRANCHES" 'BEGIN { exit !((line + 0) < min_line || (branch + 0) < min_branch) }'; then
  node_status="fail"
  status="fail"
fi

if [ "$status" = "pass" ]; then
  status="partial"
fi

{
  echo "FORMAT_VERSION=1"
  echo "REPO=hal-minting-contracts"
  echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "THRESHOLD_LINES=$THRESHOLD_LINES"
  echo "THRESHOLD_BRANCHES=$THRESHOLD_BRANCHES"
  echo "TOTAL_LINES_PCT=$line_pct"
  echo "TOTAL_BRANCHES_PCT=$branch_pct"
  echo "STATUS=$status"
  echo "SOURCE_PATHS=src/**/*.ts,smart-contract/**/*.ak"
  echo "EXCLUDED_PATHS=scripts/**:operator/manual scripts not part of package runtime test flow;smart-contract/**:Aiken coverage metrics unavailable ($AIKEN_NOTE)"
  echo "LANGUAGE_SUMMARY=nodejs:lines=$line_pct,branches=$branch_pct,tool=vitest-v8+nyc,status=$node_status;aiken:lines=NA,branches=NA,tool=$AIKEN_TOOL,status=na"
  echo
  echo "=== RAW_OUTPUT_NODE_TESTS ==="
  cat "$TEST_LOG"
  echo
  echo "=== RAW_OUTPUT_AIKEN_TESTS ==="
  cat "$AIKEN_LOG"
} > "$REPORT_FILE"

if [ "$node_status" = "fail" ]; then
  echo "Coverage threshold failed: lines=$line_pct branches=$branch_pct" >&2
  exit 1
fi

echo "Coverage thresholds passed for measurable sources: lines=$line_pct branches=$branch_pct"
