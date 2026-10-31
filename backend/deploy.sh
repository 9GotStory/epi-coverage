#!/bin/bash
# Script to deploy to the EXACT SAME deployment ID to avoid breaking the frontend .env URL
# Issue #73: the production deployment ID must not live in a tracked file.
# It is read from the untracked backend/deploy.config.sh — copy deploy.config.example
# to deploy.config.sh to create it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/deploy.config.sh"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "❌ Missing ${CONFIG_FILE}" >&2
  echo "   Copy backend/deploy.config.example to backend/deploy.config.sh and set DEPLOYMENT_ID." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$CONFIG_FILE"

if [[ -z "${DEPLOYMENT_ID:-}" ]]; then
  echo "❌ DEPLOYMENT_ID is not set in ${CONFIG_FILE}" >&2
  exit 1
fi

if [[ ! "$DEPLOYMENT_ID" =~ ^AKfyc[A-Za-z0-9_-]+$ ]]; then
  echo "❌ DEPLOYMENT_ID in ${CONFIG_FILE} does not look like a GAS deployment ID (expected AKfyc…)" >&2
  echo "   If the example placeholder was copied verbatim, set the real ID — see 'npx @google/clasp deployments'." >&2
  exit 1
fi

MESSAGE="${1:-Update}"
cd "$SCRIPT_DIR"
npx @google/clasp push -f
npx @google/clasp deploy -i "$DEPLOYMENT_ID" -d "$MESSAGE"
