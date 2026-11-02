#!/usr/bin/env bash
# Local test run recorded by adahandle-deployments/common/test-evidence.sh (replaces the old Actions tests).
set -euo pipefail
( set -e; npm ci )
( cd smart-contract && set -e; aiken fmt --check )
( set -e; npm run lint )
( cd smart-contract && set -e; aiken check )
( set -e; npm run test )
